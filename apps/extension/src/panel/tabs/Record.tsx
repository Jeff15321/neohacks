import React, { useCallback, useEffect, useState } from 'react';
import type { RecordingSession, SemanticStep, Step, WorkflowSpec } from '@app/contracts';
import { Button } from '../components/ui/button.js';
import { Badge, Disclosure, Empty, Textarea } from '../components/ui/primitives.js';
import { ApprovalCard } from '../components/WidgetCards.js';
import { send, useBroadcast } from '../hooks/useBus.js';
import { usePanel } from '../app/state.js';
import { cn, fmtTime } from '../lib/utils.js';

/**
 * Owner: Phase B. Live Step timeline while recording (raw row + async Tier-1 meaning row, decision A);
 * Stop → Review sheet: SemanticSteps + WorkflowSpec → strike steps / answer questions / instructions → Generate.
 */
interface RecData { session: RecordingSession | null; steps: Step[]; semantic: Record<string, SemanticStep>; spec: WorkflowSpec | null; widgetId?: string }
const EMPTY: RecData = { session: null, steps: [], semantic: {}, spec: null };

function useRecording() {
  const [d, setD] = useState<RecData>(EMPTY);
  const [specError, setSpecError] = useState('');
  const load = useCallback(() => {
    void send<RecData>({ type: 'REC_GET' }).then(r => { if (r.ok) setD({ session: r.session, steps: r.steps ?? [], semantic: r.semantic ?? {}, spec: r.spec ?? null, widgetId: r.widgetId }); });
  }, []);
  useEffect(load, [load]);
  useBroadcast(msg => {
    switch (msg.type) {
      case 'REC_STATE':
        setD(p => (msg.session?.id !== p.session?.id ? { ...EMPTY, session: msg.session } : { ...p, session: msg.session }));
        if (msg.session?.status === 'interpreting') setSpecError('');
        break;
      case 'STEP_ADDED': if (msg.recording) setD(p => (p.steps.some(s => s.seq === msg.step.seq) ? p : { ...p, steps: [...p.steps, msg.step] })); break;
      case 'STEP_UPDATED': setD(p => ({ ...p, steps: p.steps.map(s => (s.id === msg.step.id ? msg.step : s)) })); break;
      case 'STEP_MEANING': setD(p => ({ ...p, semantic: { ...p.semantic, [String(msg.seq)]: msg.semantic } })); break;
      case 'REC_SPEC': setD(p => ({ ...p, spec: msg.spec })); setSpecError(msg.error ?? ''); break;
      case 'REC_WIDGET': setD(p => ({ ...p, widgetId: msg.widget.id })); break;
    }
  });
  return { d, load, specError };
}

/** Header button (App.tsx): toggles recording; shows the shortcut. */
export function RecordButton() {
  const { d } = useRecording();
  const { setError, setTab } = usePanel();
  const rec = d.session?.status === 'recording';
  return (
    <Button size="sm" variant={rec ? 'destructive' : 'outline'} className="h-6" data-testid="rec-toggle" title="Record a workflow (Alt+Shift+R)"
      onClick={async () => {
        setTab('record');
        const r = await send({ type: rec ? 'REC_STOP' : 'REC_START' });
        if (!r.ok) setError(r.error ?? 'recording failed');
      }}>{rec ? '■ Stop' : '● Record'}</Button>
  );
}

const fmtTarget = (s: Step) => {
  const t = s.action.target;
  const name = s.action.accessibleName ?? t?.accessibleName;
  return [t?.role ?? t?.tag, name && `"${name.slice(0, 50)}"`].filter(Boolean).join(' ') || s.action.key || '';
};

function StepRow({ s, sem, struck, onStrike }: { s: Step; sem?: SemanticStep; struck?: boolean; onStrike?: () => void }) {
  const live = [...s.effects.liveRegionText, ...(s.lateEffects?.liveRegionText ?? [])];
  const net = [...s.effects.net, ...(s.lateEffects?.net ?? [])];
  return (
    <div data-testid="step-row" data-seq={s.seq} className={cn('rounded-md border px-2 py-1.5 text-[11.5px]', struck && 'opacity-50')}>
      <div className="flex items-center gap-1.5" data-testid="step-raw">
        <span className="font-mono text-muted-foreground">#{s.seq}</span>
        <Badge variant="outline">{s.action.kind}</Badge>
        <span className={cn('min-w-0 flex-1 truncate', struck && 'line-through')}>{fmtTarget(s)}</span>
        {!s.settled && <Badge variant="warning" title={s.settle?.reason}>unsettled</Badge>}
        {onStrike && (
          <label className="flex items-center gap-1 text-[10.5px] text-muted-foreground" title="Ignore this step">
            <input type="checkbox" data-testid="step-strike" checked={!!struck} onChange={onStrike} />ignore
          </label>
        )}
      </div>
      <div className="mt-0.5 flex flex-wrap gap-1 text-[10.5px] text-muted-foreground">
        {s.action.valuePreview && <span>value: “{s.action.valuePreview.slice(0, 60)}”</span>}
        {s.effects.addedRegions.length > 0 && <span>+{s.effects.addedRegions.length} region{s.effects.addedRegions.length > 1 ? 's' : ''}</span>}
        {s.effects.urlChange && <span>→ url</span>}
        {net.map(n => <span key={n.opId} className="font-mono">{n.method} {n.routeTemplate} {n.status ?? ''}</span>)}
        {live.map(t => <Badge key={t} variant="success" data-testid="step-live">{t}</Badge>)}
      </div>
      {s.effects.addedRegions.length > 0 && (
        <Disclosure className="mt-1" title="appeared DOM">
          {s.effects.addedRegions.map((r, i) => <pre key={i} className="m-0 max-h-40 overflow-auto text-[10px] whitespace-pre">{r.root}{'\n'}{r.skeleton}</pre>)}
        </Disclosure>
      )}
      <div className="mt-1 border-t pt-1 text-[11px]" data-testid="step-meaning">
        {sem ? <span><b>{sem.verb}</b> {sem.object}</span> : <span className="text-muted-foreground">interpreting…</span>}
      </div>
    </div>
  );
}

function SpecView({ spec, answers, setAnswer }: { spec: WorkflowSpec; answers: Record<string, string>; setAnswer: (q: string, a: string) => void }) {
  return (
    <div className="space-y-2 text-[12px]" data-testid="spec">
      <div><div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Goal</div><div data-testid="spec-goal">{spec.goal}</div></div>
      <div className="text-xs text-muted-foreground">Trigger: {spec.trigger.placement} · {spec.trigger.site}</div>
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Slots (inputs)</div>
        {spec.inputs.length ? spec.inputs.map(i => <div key={i.name} data-testid="spec-slot"><b>{i.name}</b> ← {i.source}</div>) : <div className="text-muted-foreground">none</div>}
        {spec.outputs.map(o => <div key={o.name} data-testid="spec-output">→ <b>{o.name}</b> into {o.sink}</div>)}
      </div>
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Steps</div>
        <ol className="m-0 list-decimal space-y-0.5 pl-4">
          {spec.steps.map((s, i) => <li key={i} data-testid="spec-step">{s.intent} <Badge variant="outline">{s.role}</Badge>{s.evidence.stepSeq.length ? <span className="text-muted-foreground"> #{s.evidence.stepSeq.join(', #')}</span> : null}</li>)}
        </ol>
      </div>
      {spec.successCriteria.length > 0 && <div className="text-xs"><span className="text-muted-foreground">Success: </span>{spec.successCriteria.join('; ')}</div>}
      {spec.consequentialActions.length > 0 && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive" data-testid="spec-consequential">
          Stop-before (never done automatically): {spec.consequentialActions.join('; ')}
        </div>
      )}
      {spec.openQuestions.length > 0 && (
        <div className="space-y-1">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Open questions</div>
          {spec.openQuestions.map(q => (
            <div key={q}>
              <div className="text-xs">{q}</div>
              <input data-testid="spec-answer" className="h-7 w-full rounded-md border bg-transparent px-2 text-xs" value={answers[q] ?? ''} onChange={e => setAnswer(q, e.target.value)} placeholder="Your answer" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function RecordTab() {
  const { d, specError } = useRecording();
  const { widgets, setError, settings } = usePanel();
  const [struck, setStruck] = useState<number[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [instructions, setInstructions] = useState('');
  const [busy, setBusy] = useState('');
  const s = d.session;
  useEffect(() => { setStruck(s?.struck ?? []); setInstructions(s?.instructions ?? ''); }, [s?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (label: string, msg: Parameters<typeof send>[0]) => {
    setBusy(label); setError('');
    const r = await send(msg);
    if (!r.ok) setError(r.error ?? `${label} failed`);
    setBusy('');
    return r;
  };
  const answersList = () => Object.entries(answers).filter(([, a]) => a.trim()).map(([question, answer]) => ({ question, answer }));
  const widget = d.widgetId ? widgets.find(w => w.id === d.widgetId) : undefined;

  if (settings && !settings.record) return <Empty>Recording is switched off (settings flag <code>record</code>).</Empty>;
  const recording = s?.status === 'recording';
  return (
    <div className="space-y-3" data-testid="record-tab">
      <div className="flex items-center gap-2">
        {recording
          ? <Button variant="destructive" data-testid="rec-stop" onClick={() => void act('stop', { type: 'REC_STOP' })}>■ Stop recording</Button>
          : <Button variant="accent" data-testid="rec-start" onClick={() => void act('start', { type: 'REC_START' })}>● Start recording</Button>}
        <span className="text-[11px] text-muted-foreground">Alt+Shift+R · click the in-page REC pill to stop</span>
        {s && <Badge className="ml-auto" data-testid="rec-status" variant={recording ? 'destructive' : s.status === 'ready' ? 'success' : 'outline'}>{s.status}</Badge>}
      </div>
      {!s && <Empty>Record a workflow once (e.g. reply to one email), then turn it into a widget.</Empty>}
      {s && (
        <section className="space-y-1.5" data-testid="step-timeline">
          <h4 className="m-0 text-xs font-semibold">Steps <span className="font-normal text-muted-foreground">({d.steps.length}) · started {fmtTime(s.startedAt)}</span></h4>
          {d.steps.map(st => (
            <StepRow key={st.seq} s={st} sem={d.semantic[String(st.seq)]} struck={struck.includes(st.seq)}
              onStrike={recording ? undefined : () => setStruck(p => (p.includes(st.seq) ? p.filter(x => x !== st.seq) : [...p, st.seq]))} />
          ))}
          {recording && d.steps.length === 0 && <div className="text-xs text-muted-foreground">Waiting for your first action…</div>}
        </section>
      )}
      {s && !recording && (
        <section className="space-y-2 rounded-lg border p-2.5" data-testid="review">
          <div className="flex items-center gap-2">
            <h4 className="m-0 text-xs font-semibold">Review</h4>
            {s.status === 'interpreting' && <span className="text-[11px] text-muted-foreground" data-testid="interpreting">interpreting the workflow…</span>}
          </div>
          {(specError || s.error) && <div className="text-xs text-destructive">{specError || s.error}</div>}
          {d.spec && <SpecView spec={d.spec} answers={answers} setAnswer={(q, a) => setAnswers(p => ({ ...p, [q]: a }))} />}
          <Textarea id="rec-instructions" data-testid="rec-instructions" placeholder='Instructions, e.g. "draft only, do all unread", "run from a toolbar button"'
            value={instructions} onChange={e => setInstructions(e.target.value)} />
          <div className="flex flex-wrap gap-1.5">
            <Button variant="outline" data-testid="rec-interpret" disabled={!!busy || s.status === 'interpreting' || !d.steps.length}
              onClick={() => void act('interpret', { type: 'REC_INTERPRET', struck, answers: answersList(), instructions })}>
              {d.spec ? 'Re-interpret with edits' : 'Interpret'}
            </Button>
            <Button variant="accent" data-testid="rec-generate" disabled={!!busy || !d.spec || s.status === 'interpreting'}
              onClick={() => void act('generate', { type: 'REC_GENERATE', instructions })}>
              {busy === 'generate' ? 'Generating…' : 'Generate widget'}
            </Button>
            <Button variant="ghost" data-testid="rec-discard" disabled={!!busy} onClick={() => void act('discard', { type: 'REC_DISCARD' })}>Discard</Button>
          </div>
        </section>
      )}
      {widget && !widget.approved && <ApprovalCard key={`${widget.id}:${widget.version}`} w={widget} />}
      {widget?.approved && <div className="text-xs text-muted-foreground" data-testid="rec-widget-installed">Installed “{widget.name}” — see the Widgets tab.</div>}
    </div>
  );
}
