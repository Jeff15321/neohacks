/**
 * Recording (doc §3, decision A): window-global RecordingSession that follows tab switches, REC badge + in-page
 * pill, live Tier-1 meanings, stop → Workflow Interpreter → spec → generate (widget conditioned on the spec).
 */
import type {
  EvidenceStep, InterpretRecordingResponse, InterpretStepsResponse, RecordingSession, SemanticStep, Step, StepDraft, WidgetRecord, WorkflowSpec,
} from '@app/contracts';
import { lineageEdges, randomId, redactStepForExport } from '@app/core';
import type { Bus } from '../../bus.js';
import { action, backend, tabs } from '../../platform/index.js';
import { recStore, type RecState } from './store.js';

const now = () => Date.now();

export class RecordService {
  state: RecState | null = null;
  readonly ready: Promise<void>;
  /** E1 instrumentation: every chrome.commands event the SW saw. */
  readonly commandLog: Array<{ command: string; ts: number }> = [];
  private saveT: ReturnType<typeof setTimeout> | undefined;

  constructor(private bus: Bus) {
    this.ready = recStore.load().then(s => {
      this.state = s;
      if (s?.session.status === 'recording') void action.setBadge('REC');
    });
  }

  get recording() { return this.state?.session.status === 'recording'; }
  get session(): RecordingSession | null { return this.state?.session ?? null; }

  private persist(immediate = false) {
    clearTimeout(this.saveT);
    if (immediate) { void recStore.save(this.state); return; }
    this.saveT = setTimeout(() => void recStore.save(this.state), 150);
  }
  private announce(traceId?: string) {
    this.bus.broadcast({ type: 'REC_STATE', session: this.session, traceId });
  }

  /** Whether the content script in `tab` should capture Steps / show the pill. */
  captureFor(tab?: chrome.tabs.Tab): { capture: boolean; recording: boolean; stepCount?: number } {
    const s = this.session;
    const inSession = !!s && s.status === 'recording' && (!s.windowId || !tab?.windowId || tab.windowId === s.windowId);
    const observe = (() => { try { return this.bus.use('settings.get')().observe; } catch { return false; } })();
    return { capture: inSession || observe, recording: inSession, stepCount: inSession ? s!.steps.length : undefined };
  }

  private async tellTab(tabId: number) {
    try {
      const tab = await tabs.get(tabId);
      await tabs.send(tabId, { type: 'WWA_REC_STATE', ...this.captureFor(tab) });
    } catch { /* no content script (chrome://, not loaded yet) */ }
  }

  private async snapshot(tab: chrome.tabs.Tab | undefined) {
    if (!this.state || !tab?.id) return;
    try {
      const ctx = await this.bus.use('page.context')(tab);
      const page = { url: ctx.url, title: ctx.title, skeleton: ctx.domSkeleton?.slice(0, 3000) };
      if (!this.state.pages.some(p => p.url === page.url && p.title === page.title)) this.state.pages = [...this.state.pages, page].slice(-10);
    } catch { /* page context unavailable */ }
  }

  async start(traceId: string, tabId?: number): Promise<RecordingSession> {
    await this.ready;
    if (!this.bus.use('settings.get')().record) throw new Error('recording is disabled in settings (record flag)');
    if (this.recording) return this.session!;
    const tab = tabId !== undefined ? await tabs.get(tabId) : await tabs.findTarget();
    if (!tab?.id) throw new Error('no eligible web page tab to record');
    const session: RecordingSession = {
      id: randomId('rec'), startedAt: now(), startTab: tab.id, tabs: [tab.id], steps: [], status: 'recording',
      traceId, windowId: tab.windowId,
    };
    this.state = { session, steps: [], semantic: {}, spec: null, pages: [] };
    await action.setBadge('REC');
    await this.tellTab(tab.id);
    await this.snapshot(tab);
    this.persist(true);
    this.announce(traceId);
    return session;
  }

  /** Step from the observe store. Only Steps of the recording window are part of the session. */
  onStep(step: Step, update: boolean) {
    const st = this.state;
    if (!st || st.session.status !== 'recording') {
      if (update && st) { const i = st.steps.findIndex(s => s.id === step.id); if (i >= 0) { st.steps[i] = step; this.persist(); } }
      return;
    }
    if (update) {
      const i = st.steps.findIndex(s => s.id === step.id);
      if (i >= 0) { st.steps[i] = step; this.persist(); }
      return;
    }
    if (st.session.windowId !== undefined && step.windowId !== undefined && step.windowId !== st.session.windowId) return;
    st.steps.push(step);
    st.session.steps.push(step.seq);
    if (step.tabId >= 0 && !st.session.tabs.includes(step.tabId)) st.session.tabs.push(step.tabId);
    this.persist();
    this.bus.broadcast({ type: 'STEP_ADDED', step, recording: true, traceId: st.session.traceId });
    if (step.tabId >= 0) void this.tellTab(step.tabId); // pill step count
    // §3: full PageContext at each route change (deduped by url+title)
    if (step.tabId >= 0 && (step.effects.urlChange || step.action.kind === 'navigate')) void tabs.get(step.tabId).then(t => this.snapshot(t)).catch(() => {});
    void this.interpretStep(step);
  }

  /** Tier-1 Step Interpreter (Haiku), async per Step; the panel fills the meaning row when it arrives. */
  private async interpretStep(step: Step) {
    const st = this.state;
    if (!st) return;
    const recent = Object.values(st.semantic).sort((a, b) => a.seq - b.seq).slice(-5);
    try {
      const r = await backend.post<InterpretStepsResponse>('/api/recordings/steps/interpret', { steps: [redactStepForExport(step)], recent }, st.session.traceId);
      const sem = r.semantic?.find(s => s.seq === step.seq) ?? r.semantic?.[0];
      if (!r.ok || !sem || this.state !== st) return;
      st.semantic[String(step.seq)] = { ...sem, seq: step.seq };
      this.persist();
      this.bus.broadcast({ type: 'STEP_MEANING', seq: step.seq, semantic: st.semantic[String(step.seq)], traceId: st.session.traceId });
    } catch (e) { console.warn('[wwa] step interpret failed', e); }
  }

  /** Recording follows tab switches within its window: tab-switch Step + pill on the new tab. */
  async onTabActivated(tabId: number, windowId: number) {
    await this.ready;
    const s = this.session;
    if (!s || s.status !== 'recording' || (s.windowId !== undefined && s.windowId !== windowId)) return;
    let tab: chrome.tabs.Tab | undefined;
    try { tab = await tabs.get(tabId); } catch { return; }
    if (!tab.url || !/^https?:/.test(tab.url)) return;
    await this.ingestSwStep({ kind: 'tab-switch', accessibleName: tab.title }, tab);
    await this.tellTab(tabId);
    await this.snapshot(tab);
  }

  /** Full top-frame navigation in a participating tab (SPA changes are reported by the content script). */
  async onNavigation(tabId: number, url: string, transitionType: string) {
    await this.ready;
    const s = this.session;
    if (!s || s.status !== 'recording' || !s.tabs.includes(tabId) || transitionType === 'auto_subframe') return;
    let tab: chrome.tabs.Tab | undefined;
    try { tab = await tabs.get(tabId); } catch { return; }
    await this.ingestSwStep({ kind: 'navigate', accessibleName: transitionType }, { ...tab, url });
  }

  private async ingestSwStep(a: { kind: 'tab-switch' | 'navigate'; accessibleName?: string }, tab: chrome.tabs.Tab) {
    const url = tab.url ?? '';
    let origin = '';
    try { origin = new URL(url).origin; } catch { /* keep empty */ }
    const draft: StepDraft = {
      id: randomId('st'), origin, url, action: { kind: a.kind, accessibleName: a.accessibleName?.slice(0, 120) },
      effects: { addedRegions: [], removedRegions: [], liveRegionText: [], net: [], mutatingOk: false },
      settled: true, tStart: now(), tEnd: now(), title: tab.title,
    };
    await this.bus.use('steps.ingest')(draft, tab.id ?? -1, tab.windowId);
  }

  async stop(traceId: string, opts: { interpret?: boolean } = {}): Promise<RecordingSession | null> {
    await this.ready;
    const st = this.state;
    if (!st || st.session.status !== 'recording') return this.session;
    // Commit pending input + close open Steps in every participating tab first (they arrive via WWA_STEP).
    await Promise.all(st.session.tabs.map(id => Promise.race([
      tabs.send(id, { type: 'WWA_STEPS_FLUSH' }).catch(() => undefined),
      new Promise(r => setTimeout(r, 1500)),
    ])));
    st.session.status = 'stopped';
    st.session.stoppedAt = now();
    await action.setBadge('');
    for (const id of st.session.tabs) void this.tellTab(id);
    try { await this.snapshot(await tabs.get(st.session.tabs[st.session.tabs.length - 1])); } catch { /* tab gone */ }
    this.persist(true);
    this.announce(traceId);
    if (opts.interpret !== false && st.steps.length) void this.interpret(traceId, {}).catch(() => {});
    return st.session;
  }

  async toggle(traceId: string, tabId?: number) {
    await this.ready;
    return this.recording ? this.stop(traceId) : this.start(traceId, tabId);
  }

  /** Workflow Interpreter (Opus) via the backend; review-sheet edits are applied and kept on the session. */
  async interpret(traceId: string, edits: { struck?: number[]; answers?: Array<{ question: string; answer: string }>; instructions?: string }): Promise<WorkflowSpec> {
    await this.ready;
    const st = this.state;
    if (!st) throw new Error('no recording');
    if (st.session.status === 'recording') throw new Error('stop the recording first');
    if (!st.steps.length) throw new Error('recording has no steps');
    if (edits.struck) st.session.struck = edits.struck;
    if (edits.answers) st.session.answers = edits.answers;
    if (edits.instructions !== undefined) st.session.instructions = edits.instructions;
    st.session.status = 'interpreting';
    st.session.error = undefined;
    this.persist(true);
    this.announce(traceId);
    try {
      const semantic: SemanticStep[] = Object.values(st.semantic);
      const res = await backend.post<InterpretRecordingResponse>('/api/recordings/interpret', {
        recordingId: st.session.id,
        steps: st.steps.map(redactStepForExport),
        semantic,
        struck: st.session.struck,
        answers: st.session.answers,
        instructions: st.session.instructions,
        prior: st.spec ?? undefined,
        pages: st.pages,
      }, traceId);
      if (!res.ok || !res.spec) throw new Error(res.error ?? 'interpretation failed');
      if (this.state !== st) throw new Error('recording was replaced');
      st.spec = { ...res.spec, dataFlow: res.spec.dataFlow.length ? res.spec.dataFlow : lineageEdges(st.steps) };
      st.session.status = 'ready';
      this.persist(true);
      this.bus.broadcast({ type: 'REC_SPEC', spec: st.spec, traceId });
      this.announce(traceId);
      return st.spec;
    } catch (e) {
      st.session.status = 'stopped';
      st.session.error = String((e as Error)?.message ?? e);
      this.persist(true);
      this.bus.broadcast({ type: 'REC_SPEC', spec: st.spec, error: st.session.error, traceId });
      this.announce(traceId);
      throw e;
    }
  }

  /** Evidence fragments for the generator: the Steps the spec cites (else all non-struck Steps). */
  evidence(spec: WorkflowSpec): EvidenceStep[] {
    const st = this.state!;
    const struck = new Set(st.session.struck ?? []);
    const cited = new Set(spec.steps.flatMap(s => s.evidence.stepSeq));
    const pick = st.steps.filter(s => !struck.has(s.seq) && (!cited.size || cited.has(s.seq)));
    return pick.slice(0, 40).map(s => {
      const r = redactStepForExport(s);
      const sem = st.semantic[String(s.seq)];
      return {
        seq: s.seq, kind: s.action.kind, url: s.url,
        target: s.action.target ? { ...s.action.target, candidates: s.action.target.candidates.slice(0, 4) } : undefined,
        valuePreview: r.action.valuePreview,
        addedRegions: s.effects.addedRegions.slice(0, 3),
        liveRegionText: [...s.effects.liveRegionText, ...(s.lateEffects?.liveRegionText ?? [])].slice(0, 6),
        net: [...s.effects.net, ...(s.lateEffects?.net ?? [])].slice(0, 8),
        meaning: sem ? `${sem.verb} ${sem.object}` : undefined,
      };
    });
  }

  async generate(traceId: string, opts: { spec?: WorkflowSpec; instructions?: string }): Promise<WidgetRecord> {
    await this.ready;
    const st = this.state;
    if (!st) throw new Error('no recording');
    const spec = opts.spec ?? st.spec;
    if (!spec) throw new Error('interpret the recording first');
    if (opts.spec) st.spec = opts.spec;
    if (opts.instructions !== undefined) st.session.instructions = opts.instructions;
    const instr = st.session.instructions?.trim();
    const request = `Build a widget that automates this recorded workflow: ${spec.goal}${instr ? `\nUser instructions: ${instr}` : ''}`.slice(0, 4000);
    const lastTab = st.session.tabs[st.session.tabs.length - 1];
    // Phase F: a cross-tab recording (GitHub → Jira) builds a bundle whose HOME is where the user started
    const homeTab = st.session.tabs.length > 1 ? st.session.startTab : lastTab;
    const w = await this.bus.use('widgets.generate')(request, traceId, { spec, evidence: this.evidence(spec), tabId: homeTab });
    st.widgetId = w.id;
    this.persist(true);
    this.bus.broadcast({ type: 'REC_WIDGET', widget: w, traceId });
    return w;
  }

  async discard(traceId: string) {
    await this.ready;
    if (this.recording) await this.stop(traceId, { interpret: false });
    this.state = null;
    this.persist(true);
    this.announce(traceId);
  }
}
