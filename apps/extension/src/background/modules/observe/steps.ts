/**
 * Step store (Phase B): assigns the global monotonic `seq`, keeps a ring of recent Steps in storage.session
 * (survives SW restarts, cleared with the browser session), merges late effects, notifies subscribers.
 */
import { Step, type StepDraft, type StepLateEffects } from '@app/contracts';
import { redactStepForExport } from '@app/core';
import { storage } from '../../platform/index.js';

const SEQ_KEY = 'wwa_step_seq';
const STEPS_KEY = 'wwa_steps';
const MAX = 300;

export class StepStore {
  private seq = 0;
  private steps: Step[] = [];
  private subs = new Set<(s: Step, update: boolean) => void>();
  readonly ready: Promise<void>;
  private chain: Promise<unknown> = Promise.resolve();

  constructor() {
    this.ready = (async () => {
      this.seq = (await storage.session.get<number>(SEQ_KEY)) ?? 0;
      const saved = await storage.session.get<unknown[]>(STEPS_KEY);
      this.steps = (saved ?? []).flatMap(s => { const r = Step.safeParse(s); return r.success ? [r.data] : []; });
    })();
  }

  /** Serialised so seq order == arrival order even across awaits. */
  ingest(draft: StepDraft, tabId: number, windowId?: number): Promise<Step> {
    const p = this.chain.then(async () => {
      await this.ready;
      const step: Step = redactStepForExport({ ...draft, seq: ++this.seq, tabId, windowId });
      this.steps.push(step);
      if (this.steps.length > MAX) this.steps.splice(0, this.steps.length - MAX);
      void storage.session.set(SEQ_KEY, this.seq);
      void storage.session.set(STEPS_KEY, this.steps);
      this.emit(step, false);
      return step;
    });
    this.chain = p.catch(() => {});
    return p;
  }

  mergeLate(stepId: string, late: StepLateEffects): Step | undefined {
    const s = this.steps.find(x => x.id === stepId);
    if (!s) return undefined;
    const cur = s.lateEffects ?? { liveRegionText: [], net: [] };
    s.lateEffects = {
      liveRegionText: [...new Set([...cur.liveRegionText, ...late.liveRegionText])].slice(0, 8),
      net: [...cur.net, ...late.net].slice(0, 12),
    };
    void storage.session.set(STEPS_KEY, this.steps);
    this.emit(s, true);
    return s;
  }

  recent(limit = 100): Step[] { return this.steps.slice(-limit); }
  bySeq(seqs: number[]): Step[] { const set = new Set(seqs); return this.steps.filter(s => set.has(s.seq)); }

  subscribe(fn: (s: Step, update: boolean) => void) { this.subs.add(fn); return () => { this.subs.delete(fn); }; }
  private emit(s: Step, update: boolean) { for (const fn of this.subs) { try { fn(s, update); } catch (e) { console.warn('[wwa] step subscriber failed', e); } } }
}
