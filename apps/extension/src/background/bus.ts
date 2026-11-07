import {
  PanelToSW, PageToSW, UserScriptMsg, SWToPanel, LIMITS, boundaryError,
  type BusLogEntry, type BusReply, type MsgOf, type NetOpSummary, type PageContext, type Settings, type WidgetGrant, type WidgetRecord, type z,
} from '@app/contracts';
import { Ring, newTraceId } from '@app/core';

export type Channel = 'panel' | 'content' | 'userScript';

export interface Ctx {
  channel: Channel;
  sender: chrome.runtime.MessageSender;
  traceId: string;
  tabId?: number;
  frameId?: number;
  tabUrl: string;
}

type Result = Record<string, unknown> | void;
type Handler<M> = (msg: M, ctx: Ctx) => Promise<Result> | Result;

/**
 * In-SW service interfaces: the only way one module may call another (Rules §2). Provided in a module's
 * index.ts via `bus.provide`, consumed via `bus.use`. Add new entries here when a phase needs one.
 */
export interface Services {
  'page.context': (tab: chrome.tabs.Tab) => Promise<PageContext>;
  'net.opsForTab': (tabId: number, origin: string, limit?: number) => Promise<NetOpSummary[]>;
  'widgets.list': () => WidgetRecord[];
  /** Returns an error string when the user script may not perform this call. */
  'widgets.authorize': (widgetId: string, tabUrl: string, grant?: WidgetGrant) => string | undefined;
  /** Module on/off flags (settings flag per module, Rules §5). */
  'settings.get': () => Settings;
}

const SCHEMAS: Record<Channel, z.ZodTypeAny> = { panel: PanelToSW, content: PageToSW, userScript: UserScriptMsg };
const BOUNDARY: Record<Channel, string> = { panel: 'panel→SW', content: 'content→SW', userScript: 'userScript→SW' };

/**
 * Typed message router: validate (zod, per boundary) → dispatch to the owning module → log every message
 * (ring buffer, shown in the Inspector "Bus" view).
 */
export class Bus {
  readonly log = new Ring<BusLogEntry>(LIMITS.BUS_LOG_SIZE);
  private seq = 0;
  private handlers: Record<Channel, Map<string, { h: Handler<any>; grant?: WidgetGrant }>> = {
    panel: new Map(), content: new Map(), userScript: new Map(),
  };
  private services = new Map<string, (...a: any[]) => any>();

  constructor(private readonly out: { broadcast: (msg: unknown) => void } = { broadcast: () => {} }) {}

  on<T extends PanelToSW['type']>(type: T, h: Handler<MsgOf<PanelToSW, T>>) { this.add('panel', type, h); }
  onPage<T extends PageToSW['type']>(type: T, h: Handler<MsgOf<PageToSW, T>>) { this.add('content', type, h); }
  /** User-script handlers; `grant` is enforced (with widget existence/approval/origin) before the handler runs. */
  onUserScript<T extends UserScriptMsg['type']>(type: T, h: Handler<MsgOf<UserScriptMsg, T>>, grant?: WidgetGrant) {
    this.add('userScript', type, h, grant);
  }

  provide<K extends keyof Services>(name: K, fn: Services[K]) { this.services.set(name, fn); }
  use<K extends keyof Services>(name: K): Services[K] {
    const fn = this.services.get(name);
    if (!fn) throw new Error(`service ${name} not provided`);
    return ((...args: unknown[]) => {
      const t0 = Date.now();
      const done = (ok: boolean, error?: string) => this.record({ type: name, channel: 'internal', from: 'sw', ok, ms: Date.now() - t0, error });
      try {
        const r = fn(...args);
        if (r && typeof (r as Promise<unknown>).then === 'function') {
          return (r as Promise<unknown>).then(v => { done(true); return v; }, e => { done(false, String(e?.message ?? e)); throw e; });
        }
        done(true);
        return r;
      } catch (e) { done(false, String((e as Error)?.message ?? e)); throw e; }
    }) as Services[K];
  }

  /** Validated SW → panel broadcast. */
  broadcast(msg: SWToPanel) {
    const r = SWToPanel.safeParse(msg);
    const ok = r.success;
    this.record({ type: msg.type, channel: 'broadcast', from: 'sw', ok, ms: 0, error: ok ? undefined : boundaryError('SW→panel', msg.type, r.error), traceId: msg.traceId });
    if (ok) this.out.broadcast(msg);
  }

  async dispatch(channel: Channel, raw: unknown, sender: chrome.runtime.MessageSender): Promise<BusReply> {
    const t0 = Date.now();
    const type = (raw as { type?: string } | null)?.type;
    const from = channel === 'panel' ? 'panel' : `${channel}:${sender.tab?.id ?? '?'}${sender.frameId ? `/${sender.frameId}` : ''}`;
    const fail = (error: string, traceId?: string): BusReply => {
      this.record({ type: type ?? '(none)', channel, from, ok: false, ms: Date.now() - t0, error, traceId });
      return { ok: false, error };
    };
    const parsed = SCHEMAS[channel].safeParse(raw);
    if (!parsed.success) return fail(boundaryError(BOUNDARY[channel], type, parsed.error));
    const msg = parsed.data as { type: string; traceId?: string; widgetId?: string };
    const traceId = msg.traceId ?? newTraceId();
    const entry = this.handlers[channel].get(msg.type);
    if (!entry) return fail(`[${BOUNDARY[channel]}] no handler for ${msg.type}`, traceId);
    const ctx: Ctx = { channel, sender, traceId, tabId: sender.tab?.id, frameId: sender.frameId, tabUrl: sender.tab?.url ?? sender.url ?? '' };
    try {
      if (channel === 'userScript') {
        const denied = this.use('widgets.authorize')(msg.widgetId ?? '', ctx.tabUrl, entry.grant);
        if (denied) return fail(denied, traceId);
      }
      const result = (await entry.h(msg, ctx)) ?? {};
      this.record({ type: msg.type, channel, from, ok: true, ms: Date.now() - t0, traceId });
      return { ok: true, traceId, ...result };
    } catch (e) {
      return fail(String((e as Error)?.message ?? e), traceId);
    }
  }

  private add(channel: Channel, type: string, h: Handler<any>, grant?: WidgetGrant) {
    if (this.handlers[channel].has(type)) throw new Error(`duplicate ${channel} handler for ${type}`);
    this.handlers[channel].set(type, { h, grant });
  }

  private record(e: Omit<BusLogEntry, 'id' | 'ts'>) {
    this.log.push({ id: ++this.seq, ts: Date.now(), ...e });
  }
}
