/**
 * Suggestions (Phase D, doc §7): Judge candidate → admit (core dedupe: dismissed / one live per pattern / ≤1 visible)
 * → speculative generation job (modules/jobs) → in-page card states generating → ready → failed.
 * Accept = adopt the job's widget as an UNAPPROVED record and open the approval card in the panel — never auto-run.
 * Persisted in storage.local (`wwa_suggestions`) so history + dismissals survive restarts.
 */
import { Suggestion, type Job, type SuggestionCandidate, type WorkingMemory } from '@app/contracts';
import { admitSuggestion, isVisible, specHash } from '@app/core';
import type { Bus } from '../../bus.js';
import { backend, sidePanel, storage, tabs } from '../../platform/index.js';

const KEY = 'wwa_suggestions';
const MAX = 50;
type Action = 'accept' | 'not_now' | 'never' | 'retry' | 'restore';

export class SuggestionManager {
  private list: Suggestion[] = [];
  readonly ready: Promise<void>;
  /** Patterns the user said "Never for this" to (mirrors backend WorkingMemory.dismissed). */
  private dismissed = new Set<string>();
  lastNote = '';
  /** Set by activity.ts: the backend's WorkingMemory after dismiss/restore (keeps the Activity view current). */
  onMemory: (m: WorkingMemory) => void = () => {};

  constructor(private bus: Bus, private onChange: () => void) {
    this.ready = (async () => {
      const saved = await storage.local.get<unknown[]>(KEY);
      this.list = (saved ?? []).flatMap(s => { const r = Suggestion.safeParse(s); return r.success ? [r.data] : []; });
      for (const s of this.list) if (s.status === 'dismissed') this.dismissed.add(s.patternId);
      // resume watching jobs that were generating when the SW died
      for (const s of this.list) if (s.status === 'generating' && s.jobId) {
        const j = this.bus.use('jobs.get')(s.jobId);
        if (j) this.onJob(s.id, j);
      }
    })();
  }

  all() { return [...this.list].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)); }
  visibleFor(origin: string) { return this.list.find(s => isVisible(s) && s.origin === origin) ?? null; }
  syncDismissed(m: WorkingMemory) { for (const d of m.dismissed) this.dismissed.add(d.patternId); }

  private async persist() {
    this.list = this.all().slice(0, MAX);
    await storage.local.set(KEY, this.list);
  }
  private get(id: string) { const s = this.list.find(x => x.id === id); if (!s) throw new Error(`suggestion ${id} not found`); return s; }

  private async changed(s: Suggestion) {
    await this.persist();
    this.bus.broadcast({ type: 'SUGGESTION_UPDATED', suggestion: s, traceId: s.traceId });
    if (s.tabId !== undefined) {
      const show = isVisible(s) ? s : null;
      try { await tabs.send(s.tabId, { type: 'WWA_SUGGESTION', suggestion: show ?? null }); } catch { /* tab gone / no content script */ }
    }
    this.onChange();
  }

  /** A Judge candidate from POST /api/observe/steps. */
  async onCandidate(c: SuggestionCandidate, tabId: number | undefined, origin: string, traceId: string) {
    await this.ready;
    if (!this.bus.use('settings.get')().suggestions) { this.lastNote = `suggestion "${c.title}" suppressed: suggestions setting is off`; this.onChange(); return; }
    const adm = admitSuggestion(this.list, c, this.dismissed);
    if (!adm.admit) { this.lastNote = `suggestion for ${c.patternId} not admitted: ${adm.reason}`; this.onChange(); return; }
    if (adm.replace) { const old = this.list.find(s => s.id === adm.replace); if (old) { old.snoozed = true; await this.changed(old); } }
    const s: Suggestion = {
      id: c.id, patternId: c.patternId, title: c.title, why: c.why, score: c.score, taskIds: c.taskIds, status: 'generating',
      request: c.request, spec: c.spec, details: c.details, origin, tabId, createdAt: Date.now(), traceId,
    };
    this.list.push(s);
    this.lastNote = `suggestion ${s.id} for ${s.patternId}`;
    await this.changed(s);
    await this.startJob(s);
  }

  private async startJob(s: Suggestion) {
    try {
      const tab = s.tabId !== undefined ? await tabs.get(s.tabId).catch(() => tabs.findTarget()) : await tabs.findTarget();
      if (!tab?.id) throw new Error('no tab for page context');
      const pageContext = await this.bus.use('page.context')(tab);
      const job = await this.bus.use('jobs.start')({
        kind: 'generate', request: s.request ?? s.title, pageContext, spec: s.spec, dedupeKey: `${s.patternId}:${specHash([s.request, s.spec])}`,
      }, s.traceId ?? s.id, (j) => this.onJob(s.id, j));
      s.jobId = job.id;
      await this.persist();
      this.onJob(s.id, job);
    } catch (e) {
      s.status = 'failed';
      s.error = String((e as Error)?.message ?? e);
      await this.changed(s);
    }
  }

  private onJob(id: string, job: Job) {
    const s = this.list.find(x => x.id === id);
    if (!s || s.jobId !== job.id || s.status === 'dismissed' || s.status === 'accepted') return;
    if (job.status === 'succeeded') {
      s.status = 'ready';
      s.error = undefined;
      void this.changed(s).then(() => { if (s.acceptPending) void this.accept(s); });
    } else if (job.status === 'failed' || job.status === 'cancelled') {
      s.status = 'failed';
      s.error = job.error ?? job.status;
      void this.changed(s);
    }
  }

  private async accept(s: Suggestion) {
    const job = s.jobId ? this.bus.use('jobs.get')(s.jobId) : undefined;
    if (s.status !== 'ready' || !job?.result) { s.acceptPending = true; await this.changed(s); return; }
    const w = await this.bus.use('widgets.adopt')(job.result.widget, s.request ?? s.title, s.traceId ?? s.id, { origin: s.origin ?? '', spec: s.spec, warnings: job.result.warnings });
    s.status = 'accepted';
    s.acceptPending = false;
    s.widgetId = w.id;
    await this.changed(s);
    this.bus.broadcast({ type: 'SUGGESTION_ACCEPTED', suggestionId: s.id, widgetId: w.id, traceId: s.traceId });
  }

  async act(id: string, action: Action, ctx: { tabId?: number; windowId?: number }) {
    await this.ready;
    const s = this.get(id);
    switch (action) {
      case 'accept':
        void sidePanel.open(ctx.tabId, ctx.windowId); // card click = user gesture; the approval card lives in the panel
        await this.accept(s);
        break;
      case 'not_now':
        s.snoozed = true;
        await this.changed(s);
        break;
      case 'never': {
        s.status = 'dismissed';
        s.snoozed = false;
        s.acceptPending = false;
        this.dismissed.add(s.patternId);
        const job = s.jobId ? this.bus.use('jobs.get')(s.jobId) : undefined;
        if (job && (job.status === 'queued' || job.status === 'running')) await this.bus.use('jobs.cancel')(job.id);
        const r = await backend.post<{ state?: WorkingMemory }>('/api/observe/dismiss', { patternId: s.patternId, reason: 'never for this' }, s.traceId).catch(() => null);
        if (r?.state) this.onMemory(r.state);
        await this.changed(s);
        break;
      }
      case 'retry':
        if (s.status !== 'failed') break;
        s.status = 'generating';
        s.error = undefined;
        await this.changed(s);
        await this.startJob(s);
        break;
      case 'restore': {
        if (s.status === 'dismissed') {
          this.dismissed.delete(s.patternId);
          const r = await backend.post<{ state?: WorkingMemory }>('/api/observe/restore', { patternId: s.patternId }, s.traceId).catch(() => null);
          if (r?.state) this.onMemory(r.state);
          const job = s.jobId ? this.bus.use('jobs.get')(s.jobId) : undefined;
          s.snoozed = true; // restored into the Activity list, not re-shown on the page
          if (job?.status === 'succeeded') { s.status = 'ready'; await this.changed(s); }
          else { s.status = 'generating'; await this.changed(s); await this.startJob(s); }
        } else if (s.snoozed) { s.snoozed = false; await this.changed(s); }
        break;
      }
    }
    return s;
  }

  async clear() { this.list = this.list.filter(s => s.status === 'dismissed'); await this.persist(); this.onChange(); }
}
