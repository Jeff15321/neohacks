import React, { useCallback, useEffect, useState } from 'react';
import type { LearnedBranch, RunTimelineEvent, WidgetRun } from '@app/contracts';
import { Button } from './ui/button.js';
import { Badge, Disclosure } from './ui/primitives.js';
import { send, useBroadcast } from '../hooks/useBus.js';
import { usePanel } from '../app/state.js';
import { fmtTime } from '../lib/utils.js';
import { learnedBranchSnippet } from '@app/core/assist';

/** Phase C: self-healing run timeline, final-failure narrative and "add this branch?" offers for one widget. */
const KIND_STYLE: Partial<Record<RunTimelineEvent['kind'], string>> = {
  'expect-fail': 'text-destructive', 'final-failure': 'text-destructive font-semibold', 'danger-blocked': 'text-destructive font-semibold',
  'step-ok': 'text-success', completed: 'text-success font-semibold', 'assist-decide': 'text-accent', 'assist-create': 'text-accent',
  'assist-escalate': 'text-accent', 'learned-branch': 'text-accent',
};

const evText = (e: RunTimelineEvent) => {
  const d = (e.data ?? {}) as Record<string, unknown>;
  const bits: string[] = [];
  if (d.choice) bits.push(`chose "${String(d.choice)}"`);
  if (d.branchId) bits.push(`branch ${String(d.branchId)}`);
  if (d.source) bits.push(`(${String(d.source)})`);
  if (d.ok !== undefined) bits.push(d.ok ? 'ok' : 'failed');
  if (d.reason) bits.push(String(d.reason));
  if (d.observed) bits.push(`observed: ${String(d.observed)}`);
  if (d.error) bits.push(`error: ${String(d.error)}`);
  if (d.label) bits.push(String(d.label));
  if (e.detail) bits.push(e.detail);
  return bits.join(' · ').slice(0, 400);
};

export const learnedDiff = (step: string, l: LearnedBranch) => learnedBranchSnippet(step, l).split('\n').map(x => '+ ' + x).join('\n');

function LearnedOffer({ run, l }: { run: WidgetRun; l: LearnedBranch }) {
  const { setError, setTab } = usePanel();
  const [busy, setBusy] = useState(false);
  const decide = async (accept: boolean) => {
    setBusy(true);
    const r = await send({ type: 'LEARNED_BRANCH_DECISION', runId: run.id, step: l.step, accept });
    if (!r.ok) setError(r.error ?? 'failed'); else if (accept) setTab('create');
    setBusy(false);
  };
  return (
    <div data-testid="learned-branch" className="space-y-1.5 rounded-md border border-accent/50 bg-accent/10 p-2 text-xs">
      <div className="font-medium">The agent fixed step “{l.step}”: add this branch to the widget?</div>
      <div className="text-muted-foreground">{l.when} — {l.reason}</div>
      <pre data-testid="learned-diff" className="m-0 max-h-48 overflow-auto rounded bg-muted p-1.5 text-[10.5px] leading-snug whitespace-pre-wrap text-success">{learnedDiff(l.step, l)}</pre>
      <div className="text-[11px] text-muted-foreground">Creates a new widget version — you approve it like any other version.</div>
      <div className="flex gap-1.5">
        <Button size="sm" variant="accent" data-testid="learned-accept" disabled={busy} onClick={() => void decide(true)}>Add branch</Button>
        <Button size="sm" variant="ghost" data-testid="learned-dismiss" disabled={busy} onClick={() => void decide(false)}>Dismiss</Button>
      </div>
    </div>
  );
}

function RunView({ run }: { run: WidgetRun }) {
  const pending = run.learned.filter(l => l.status === 'pending');
  return (
    <div data-testid="run" data-run-id={run.id} data-run-status={run.status} className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <Badge variant={run.status === 'failed' ? 'destructive' : run.status === 'completed' ? 'success' : 'accent'}>{run.status}</Badge>
        <span className="text-muted-foreground">{fmtTime(run.startedAt)} · {run.interventions} agent intervention{run.interventions === 1 ? '' : 's'} · {run.events.length} events</span>
      </div>
      {run.narrative && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-destructive">Why it stopped</div>
          <pre data-testid="run-narrative" className="m-0 max-h-64 overflow-auto text-[10.5px] leading-snug whitespace-pre-wrap">{run.narrative}</pre>
        </div>
      )}
      {pending.map(l => <LearnedOffer key={l.step + l.id} run={run} l={l} />)}
      <Disclosure title={`Run timeline (${run.events.length})`} testId="run-timeline">
        <ol className="m-0 max-h-60 list-none space-y-0.5 overflow-auto p-2 font-mono text-[10.5px] leading-relaxed">
          {run.events.map((e, i) => (
            <li key={i} data-testid="run-event" data-kind={e.kind} className={KIND_STYLE[e.kind] ?? ''}>
              <span className="text-muted-foreground">{fmtTime(e.ts)}</span> {e.kind}{e.step ? ` [${e.step}]` : ''} {evText(e)}
            </li>
          ))}
        </ol>
      </Disclosure>
    </div>
  );
}

export function RunTimeline({ widgetId }: { widgetId: string }) {
  const [runs, setRuns] = useState<WidgetRun[]>([]);
  const load = useCallback(async () => {
    const r = await send<{ runs?: WidgetRun[] }>({ type: 'GET_RUNS', widgetId, limit: 5 });
    if (r.ok && r.runs) setRuns(r.runs);
  }, [widgetId]);
  useEffect(() => { void load(); }, [load]);
  useBroadcast(msg => {
    if (msg.type !== 'RUN_UPDATED' || msg.run.widgetId !== widgetId) return;
    setRuns(prev => [msg.run, ...prev.filter(r => r.id !== msg.run.id)].sort((a, b) => b.startedAt - a.startedAt).slice(0, 5));
  });
  if (!runs.length) return null;
  const [latest, ...older] = runs;
  return (
    <div data-testid="run-timeline-panel" className="space-y-1.5">
      <RunView run={latest} />
      {older.length > 0 && (
        <Disclosure title={`Earlier runs (${older.length})`}>
          <div className="space-y-2 p-2">{older.map(r => <RunView key={r.id} run={r} />)}</div>
        </Disclosure>
      )}
    </div>
  );
}
