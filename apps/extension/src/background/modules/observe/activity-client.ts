/**
 * ObserveClient (Phase D, doc §1.3/§2): sends settled Steps to POST /api/observe/steps — ONE request in flight at a
 * time; Steps arriving meanwhile queue in storage.session (survives SW suspension) and the next request takes all
 * of them (coalescing → micro-batches under fast clicking, one call per Step in normal use).
 * Only active when Settings.observe is on (default off). Per-site denylist: sensitive origins never leave the SW.
 */
import { ObserveStepsResponse, type SemanticStep, type Step, type WorkingMemory } from '@app/contracts';
import type { Bus } from '../../bus.js';
import { backend, storage } from '../../platform/index.js';
import type { SuggestionManager } from './suggestions.js';

const QUEUE_KEY = 'wwa_observe_queue';
const MAX_BATCH = 40;
const MAX_QUEUE = 200;
/** Never observed (privacy, doc §8 risks): banking/payments/password managers/auth pages. */
const DENY = /(^|\.)(bank|banking|paypal|stripe|1password|lastpass|bitwarden|dashlane|accounts\.google)\b|\/\/(login|signin|auth)\./i;

export interface CallRecord { at: number; batch: number; queuedAtSend: number; ms: number; ok: boolean; suggestions: number; judge?: string }

export class ObserveClient {
  private queue: Step[] = [];
  private inFlight = false;
  readonly ready: Promise<void>;
  memory: WorkingMemory | null = null;
  semantic: SemanticStep[] = [];
  stats = { sent: 0, calls: 0, lastMs: undefined as number | undefined, lastError: undefined as string | undefined, lastJudge: undefined as string | undefined };
  /** E10 instrumentation: per-call batch size, queue depth and latency. */
  history: CallRecord[] = [];

  constructor(private bus: Bus, private suggestions: SuggestionManager, private onChange: () => void) {
    this.ready = (async () => {
      this.queue = (await storage.session.get<Step[]>(QUEUE_KEY)) ?? [];
      if (this.queue.length) void this.pump();
    })();
  }

  get queued() { return this.queue.length; }
  get busy() { return this.inFlight; }

  /** steps.subscribe callback. Late-effect updates are not re-sent (the Step was already interpreted). */
  onStep(s: Step, update: boolean) {
    if (update) return;
    let on = false;
    try { on = this.bus.use('settings.get')().observe; } catch { /* system module off */ }
    if (!on || DENY.test(s.origin)) return;
    void this.ready.then(() => {
      this.queue.push(s);
      if (this.queue.length > MAX_QUEUE) this.queue.splice(0, this.queue.length - MAX_QUEUE);
      void storage.session.set(QUEUE_KEY, this.queue);
      this.onChange();
      void this.pump();
    });
  }

  private async pump() {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      while (this.queue.length) {
        const batch = this.queue.slice(0, MAX_BATCH);
        const queuedAtSend = this.queue.length;
        const t0 = Date.now();
        const traceId = `t_obs_${t0.toString(36)}`;
        let res: ObserveStepsResponse | null = null;
        try {
          const raw = await backend.post<unknown>('/api/observe/steps', { steps: batch }, traceId);
          const p = ObserveStepsResponse.safeParse(raw);
          if (!p.success) throw new Error(`[backend→SW] invalid observe response: ${p.error.issues[0]?.message}`);
          res = p.data;
        } catch (e) {
          this.stats.lastError = String((e as Error)?.message ?? e);
          this.history.push({ at: t0, batch: batch.length, queuedAtSend, ms: Date.now() - t0, ok: false, suggestions: 0 });
          this.onChange();
          return; // keep the queue; the next Step retries
        }
        this.queue.splice(0, batch.length);
        void storage.session.set(QUEUE_KEY, this.queue);
        const ms = Date.now() - t0;
        Object.assign(this.stats, { sent: this.stats.sent + batch.length, calls: this.stats.calls + 1, lastMs: ms, lastError: undefined, lastJudge: res.diag.judge });
        this.history.push({ at: t0, batch: batch.length, queuedAtSend, ms, ok: true, suggestions: res.suggestions.length, judge: res.diag.judge });
        if (this.history.length > 100) this.history.splice(0, this.history.length - 100);
        this.memory = res.state;
        this.semantic = [...this.semantic, ...res.semantic].slice(-60);
        this.suggestions.syncDismissed(res.state);
        const last = batch[batch.length - 1]!;
        for (const c of res.suggestions) await this.suggestions.onCandidate(c, last.tabId >= 0 ? last.tabId : undefined, last.origin, traceId);
        this.onChange();
      }
    } finally { this.inFlight = false; }
  }

  async refresh() {
    try {
      const r = await backend.get<{ ok: boolean; state?: WorkingMemory; semantic?: SemanticStep[] }>('/api/observe/state');
      if (r.state) { this.memory = r.state; this.semantic = r.semantic ?? this.semantic; this.suggestions.syncDismissed(r.state); }
    } catch (e) { this.stats.lastError = String((e as Error)?.message ?? e); }
  }

  async clear() {
    this.queue = [];
    void storage.session.set(QUEUE_KEY, []);
    const r = await backend.request<{ state?: WorkingMemory }>('DELETE', '/api/observe/state', undefined).catch(() => null);
    this.memory = r?.state ?? null;
    this.semantic = [];
    this.history = [];
    this.onChange();
  }
}
