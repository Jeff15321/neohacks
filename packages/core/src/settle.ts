/**
 * §1.2 settle state machine (owner: Phase B). Pure: no chrome.* / DOM / timers — the caller feeds events with
 * timestamps and calls `tick(now)` at `nextDeadline()`; tests drive it with a fake clock.
 *
 * Open on an action; track significant mutations, in-flight requests and URL changes. Close after `quietMs` of quiet
 * with no in-flight requests (settled:true), or at `capMs` (settled:false). A new action closes the open Step
 * immediately. Effects up to `lateMs` after close are merged back as `lateEffects`.
 *
 * Input actions ("held" Steps) stay open while the user types and only start settling once committed.
 */

export const SETTLE_DEFAULTS = { quietMs: 400, capMs: 3000, lateMs: 6000 } as const;
export type SettleOptions = { quietMs: number; capMs: number; lateMs: number };

export interface NetEffectLite { opId: string; method: string; routeTemplate?: string; status?: number }
export interface RegionLite { root: string; skeleton: string }

export interface StepEffectsAcc {
  urlChange?: string;
  titleChange?: string;
  addedRegions: RegionLite[];
  removedRegions: string[];
  liveRegionText: string[];
  net: NetEffectLite[];
  mutatingOk: boolean;
}

export type CloseReason = 'quiet' | 'cap' | 'interrupted' | 'flush';

export interface ClosedStep<A> {
  id: string;
  action: A;
  effects: StepEffectsAcc;
  settled: boolean;
  reason: CloseReason;
  tStart: number;
  tEnd: number;
  /** Number of significant mutation batches seen (E2 instrumentation). */
  mutations: number;
  /** Time of the last activity (mutation / net / url) relative to tStart (E2: time-to-quiet). */
  lastActivityMs: number;
}

export interface LateEffects { liveRegionText: string[]; net: NetEffectLite[] }

export interface SettleCallbacks<A> {
  onClose: (s: ClosedStep<A>) => void;
  onLate?: (stepId: string, late: LateEffects) => void;
}

/** Caps on what one Step may accumulate (≈2 KB of region skeletons per Step, doc §3). */
export const STEP_CAPS = { regions: 4, regionChars: 2400, removed: 8, liveText: 6, net: 12 } as const;

const isMutatingOk = (n: NetEffectLite) => n.method.toUpperCase() !== 'GET' && n.status !== undefined && n.status >= 200 && n.status < 300;

interface Open<A> {
  id: string; action: A; tStart: number; lastActivity: number; held: boolean; commitAt?: number;
  effects: StepEffectsAcc; inflight: Set<string>; mutations: number; regionChars: number;
}
interface LateWindow { id: string; until: number; inflight: Set<string> }

export class SettleMachine<A> {
  private open: Open<A> | null = null;
  private late: LateWindow | null = null;
  private readonly opts: SettleOptions;

  constructor(private readonly cb: SettleCallbacks<A>, opts: Partial<SettleOptions> = {}) {
    this.opts = { ...SETTLE_DEFAULTS, ...opts };
  }

  get isOpen() { return !!this.open; }
  get openId() { return this.open?.id; }
  get openAction() { return this.open?.action; }

  /** Open a Step for `action`. `held` = input in progress: stays open until `commit()`. Closes any open Step first. */
  action(id: string, action: A, t: number, opts: { held?: boolean } = {}) {
    this.tick(t);
    if (this.open) this.close('interrupted', t);
    this.open = {
      id, action, tStart: t, lastActivity: t, held: !!opts.held,
      effects: { addedRegions: [], removedRegions: [], liveRegionText: [], net: [], mutatingOk: false },
      inflight: new Set(), mutations: 0, regionChars: 0,
    };
  }

  /** Commit a held (input) Step: replace its action payload and start the quiet/cap clock from now. */
  commit(t: number, action?: A) {
    if (!this.open || !this.open.held) return;
    this.open.held = false;
    this.open.commitAt = t;
    this.open.lastActivity = t;
    if (action !== undefined) this.open.action = action;
  }

  /** Update the open Step's action payload (e.g. input value) without changing timing. */
  updateAction(fn: (a: A) => A) { if (this.open) this.open.action = fn(this.open.action); }

  /** A significant DOM mutation batch (the caller filters with `isSignificantMutation`). */
  mutation(t: number, e: { added?: RegionLite[]; removed?: string[]; liveText?: string[] } = {}) {
    this.tick(t);
    if (e.liveText?.length) this.liveText(t, e.liveText);
    const o = this.open;
    if (!o) return;
    o.lastActivity = t;
    o.mutations++;
    for (const r of e.added ?? []) {
      if (o.effects.addedRegions.length >= STEP_CAPS.regions) break;
      const room = STEP_CAPS.regionChars - o.regionChars;
      if (room < 80) break;
      const skeleton = r.skeleton.length > room ? r.skeleton.slice(0, room) + '…' : r.skeleton;
      o.effects.addedRegions.push({ root: r.root, skeleton });
      o.regionChars += skeleton.length;
    }
    for (const r of e.removed ?? []) {
      if (o.effects.removedRegions.length >= STEP_CAPS.removed) break;
      if (!o.effects.removedRegions.includes(r)) o.effects.removedRegions.push(r);
    }
  }

  /** role=status/alert/aria-live (or toast) text appeared. Late text goes to the previous Step's lateEffects. */
  liveText(t: number, texts: string[]) {
    this.tick(t);
    const clean = texts.map(s => s.trim().replace(/\s+/g, ' ').slice(0, 120)).filter(Boolean);
    if (!clean.length) return;
    if (this.open) {
      this.open.lastActivity = t;
      for (const s of clean) if (this.open.effects.liveRegionText.length < STEP_CAPS.liveText && !this.open.effects.liveRegionText.includes(s)) this.open.effects.liveRegionText.push(s);
    } else if (this.late && t <= this.late.until) {
      this.cb.onLate?.(this.late.id, { liveRegionText: clean, net: [] });
    }
  }

  netStart(reqId: string, t: number) {
    this.tick(t);
    if (!this.open) return; // background request: never attributed, never blocks
    this.open.inflight.add(reqId);
    this.open.lastActivity = t;
  }

  netEnd(reqId: string, t: number, effect: NetEffectLite) {
    this.tick(t);
    const o = this.open;
    // Only requests that started during a Step are its effects (polling that merely ends now is not).
    if (o?.inflight.delete(reqId)) {
      if (o.effects.net.length < STEP_CAPS.net) o.effects.net.push(effect);
      if (isMutatingOk(effect)) o.effects.mutatingOk = true;
      o.lastActivity = t;
      return;
    }
    if (this.late && t <= this.late.until && this.late.inflight.delete(reqId)) {
      this.cb.onLate?.(this.late.id, { liveRegionText: [], net: [effect] });
    }
  }

  url(t: number, url: string) {
    this.tick(t);
    if (!this.open) return;
    this.open.effects.urlChange = url;
    this.open.lastActivity = t;
  }

  title(t: number, title: string) {
    if (this.open) this.open.effects.titleChange = title;
    void t;
  }

  /** Earliest time at which `tick` may change state (undefined = nothing pending). */
  nextDeadline(): number | undefined {
    const o = this.open;
    const lateEnd = this.late?.until;
    if (!o) return lateEnd;
    if (o.held) return undefined;
    const base = o.commitAt ?? o.tStart;
    const cap = base + this.opts.capMs;
    const quiet = o.inflight.size ? cap : Math.min(cap, o.lastActivity + this.opts.quietMs);
    return lateEnd !== undefined ? Math.min(quiet, lateEnd) : quiet;
  }

  tick(t: number) {
    if (this.late && t > this.late.until) this.late = null;
    const o = this.open;
    if (!o || o.held) return;
    const base = o.commitAt ?? o.tStart;
    if (t - base >= this.opts.capMs) { this.close('cap', base + this.opts.capMs); return; }
    if (!o.inflight.size && t - o.lastActivity >= this.opts.quietMs) this.close('quiet', o.lastActivity + this.opts.quietMs);
  }

  /** Close now (recording stop / page hide). */
  flush(t: number) {
    if (this.open?.held) this.commit(t);
    this.tick(t);
    if (this.open) this.close('flush', t);
  }

  private close(reason: CloseReason, t: number) {
    const o = this.open!;
    this.open = null;
    const settled = reason === 'quiet' || ((reason === 'interrupted' || reason === 'flush') && o.inflight.size === 0);
    this.late = { id: o.id, until: t + this.opts.lateMs, inflight: o.inflight };
    this.cb.onClose({
      id: o.id, action: o.action, effects: o.effects, settled, reason, tStart: o.tStart, tEnd: t,
      mutations: o.mutations, lastActivityMs: o.lastActivity - o.tStart,
    });
  }
}

// ---------------------------------------------------------------- significance filter (pure, DOM-free descriptor)

/** A DOM-free description of one MutationRecord, built by the content script. */
export interface MutationDesc {
  type: 'childList' | 'attributes' | 'characterData';
  /** Target (or an ancestor) is extension-owned UI (`wwa-*`). */
  inOwnUi: boolean;
  /** Target is rendered (non-zero box, not display:none). */
  targetVisible: boolean;
  addedElements?: number;
  removedElements?: number;
  /** Text-node-only changes (characterData, or childList of only text nodes). */
  textBefore?: string;
  textAfter?: string;
  attributeName?: string;
}

const TIMEISH = /^\s*(\d{1,2}:\d{2}(:\d{2})?\s*(am|pm)?|\d+\s*(s|sec|secs|seconds?|m|min|mins|minutes?|h|hr|hrs|hours?|d|days?)(\s+ago)?|just now|now|yesterday|today|[A-Z][a-z]{2}\s+\d{1,2}(,\s*\d{4})?|\d{1,2}\/\d{1,2}(\/\d{2,4})?)\s*$/i;

/** "3 min ago" → "4 min ago", "12:01" → "12:02", counters ticking: text that only changed its digits. */
export function isTimestampTick(before: string | undefined, after: string | undefined): boolean {
  const a = (before ?? '').trim(), b = (after ?? '').trim();
  if (a === b) return true;
  if (TIMEISH.test(a) && TIMEISH.test(b)) return true;
  if (a.length <= 24 && b.length <= 24 && a.replace(/\d+/g, '#') === b.replace(/\d+/g, '#')) return true;
  return false;
}

const MEANINGFUL_ATTRS = /^(hidden|open|aria-expanded|aria-hidden|aria-selected|aria-checked|aria-pressed|disabled|class|style|value|checked|selected|contenteditable)$/;

export function isSignificantMutation(d: MutationDesc): boolean {
  if (d.inOwnUi) return false;
  if (d.type === 'attributes') return d.targetVisible && MEANINGFUL_ATTRS.test(d.attributeName ?? '');
  if (d.type === 'characterData') return d.targetVisible && !isTimestampTick(d.textBefore, d.textAfter);
  // childList
  if ((d.addedElements ?? 0) > 0 || (d.removedElements ?? 0) > 0) return true;
  return d.targetVisible && !isTimestampTick(d.textBefore, d.textAfter);
}
