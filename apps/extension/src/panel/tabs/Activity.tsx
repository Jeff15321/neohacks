import React, { useCallback, useEffect, useState } from 'react';
import type { SemanticStep, Suggestion, TaskInstance, WorkingMemory } from '@app/contracts';
import { Button } from '../components/ui/button.js';
import { Badge, Disclosure, Empty } from '../components/ui/primitives.js';
import { send, useBroadcast } from '../hooks/useBus.js';
import { usePanel } from '../app/state.js';
import { fmtTime } from '../lib/utils.js';

export interface ActivitySnapshot {
  state: WorkingMemory | null;
  semantic?: SemanticStep[];
  suggestions: Suggestion[];
  diag: { queued: number; inFlight: boolean; sent: number; calls: number; lastMs?: number; lastError?: string; lastJudge?: string };
}

/** Shared hook: Activity tab + Inspector hypotheses pane. */
export function useActivity() {
  const [snap, setSnap] = useState<ActivitySnapshot | null>(null);
  const load = useCallback(async () => {
    const r = await send<ActivitySnapshot>({ type: 'ACTIVITY_GET' });
    if (r.ok) setSnap({ state: r.state, semantic: r.semantic, suggestions: r.suggestions, diag: r.diag });
  }, []);
  useEffect(() => { void load(); }, [load]);
  useBroadcast(m => {
    if (m.type === 'ACTIVITY_STATE') setSnap({ state: m.state, semantic: m.semantic, suggestions: m.suggestions, diag: m.diag });
    if (m.type === 'SUGGESTION_UPDATED') setSnap(s => s && ({ ...s, suggestions: [m.suggestion, ...s.suggestions.filter(x => x.id !== m.suggestion.id)] }));
  });
  return { snap, load };
}

/**
 * Mounted once in App (outside the tabs): when a suggestion is accepted, jump to the Create tab where the approval
 * card for the adopted (unapproved) widget is shown.
 */
export function SuggestionRouter() {
  const { setTab } = usePanel();
  useBroadcast(m => { if (m.type === 'SUGGESTION_ACCEPTED') setTab('create'); });
  return null;
}

const pct = (n: number) => `${Math.round(n * 100)}%`;
const STATUS_VARIANT: Record<string, 'default' | 'accent' | 'success' | 'warning' | 'destructive' | 'outline'> = {
  generating: 'accent', ready: 'success', failed: 'destructive', dismissed: 'outline', accepted: 'default',
  active: 'accent', completed: 'success', abandoned: 'outline', uncertain: 'warning',
};

function TaskRow({ t, testId }: { t: TaskInstance; testId: string }) {
  return (
    <div data-testid={testId} className="rounded-md border px-2.5 py-1.5 text-xs">
      <div className="flex items-center gap-1.5">
        <span className="font-medium" data-testid="task-goal">{t.goal}</span>
        <Badge variant={STATUS_VARIANT[t.status] ?? 'default'}>{t.status}</Badge>
        <span className="ml-auto text-muted-foreground" title="confidence">{pct(t.confidence)}</span>
      </div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">
        steps {t.stepRefs.map(r => `#${r.seq}${r.role === 'essential' ? '' : `(${r.role[0]})`}`).join(' ') || '—'}
        {t.patternId && <> · pattern <span className="font-mono">{t.patternId}</span></>}
        {t.completionEvidence && <> · evidence “{t.completionEvidence}”</>}
        {t.expectedNext && <> · next: {t.expectedNext}</>}
        {t.endedAt && <> · {fmtTime(t.endedAt)}</>}
      </div>
      {!!Object.keys(t.slots).length && (
        <div className="mt-0.5 text-[11px]">{Object.entries(t.slots).map(([k, v]) => <span key={k} className="mr-2"><span className="text-muted-foreground">{k}</span>={v.value.slice(0, 40)} <i className="text-muted-foreground">({v.provenance})</i></span>)}</div>
      )}
      {!!t.alternativeGoals?.length && <div className="mt-0.5 text-[11px] text-muted-foreground">or: {t.alternativeGoals.join(' | ')}</div>}
    </div>
  );
}

function SuggestionRow({ s }: { s: Suggestion }) {
  const { setError } = usePanel();
  const act = async (action: 'accept' | 'not_now' | 'never' | 'retry' | 'restore') => {
    const r = await send({ type: 'SUGGESTION_ACTION', suggestionId: s.id, action });
    if (!r.ok) setError(r.error ?? 'suggestion action failed');
  };
  return (
    <div data-testid="suggestion-row" data-status={s.status} className="rounded-md border px-2.5 py-1.5 text-xs">
      <div className="flex items-center gap-1.5">
        <span className="font-medium">{s.title}</span>
        <Badge variant={STATUS_VARIANT[s.status] ?? 'default'}>{s.status}{s.snoozed ? ' · hidden' : ''}</Badge>
      </div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{s.why} · score {s.score} · <span className="font-mono">{s.patternId}</span>{s.createdAt ? ` · ${fmtTime(s.createdAt)}` : ''}</div>
      {s.error && <div className="text-[11px] text-destructive">{s.error}</div>}
      {!!s.details?.length && (
        <Disclosure title="Why (task instances)" className="mt-1"><ol className="m-0 pl-4 text-[11px]">{s.details.map((d, i) => <li key={i}>{d}</li>)}</ol>
          <div className="text-[11px] text-muted-foreground">tasks: {s.taskIds.join(', ')}</div></Disclosure>
      )}
      <div className="mt-1 flex flex-wrap gap-1">
        {(s.status === 'ready' || s.status === 'generating') && <Button size="sm" variant="accent" className="h-6" data-testid="sg-accept" onClick={() => void act('accept')}>Accept</Button>}
        {s.status === 'failed' && <Button size="sm" variant="outline" className="h-6" onClick={() => void act('retry')}>Retry</Button>}
        {s.status === 'dismissed' && <Button size="sm" variant="outline" className="h-6" data-testid="sg-restore" onClick={() => void act('restore')}>Restore</Button>}
        {s.status !== 'dismissed' && s.status !== 'accepted' && <Button size="sm" variant="ghost" className="h-6" data-testid="sg-never" onClick={() => void act('never')}>Never for this</Button>}
      </div>
    </div>
  );
}

/** Activity: what I think you're doing (active tasks + confidence), recent completed, patterns, suggestions history. */
export function ActivityTab() {
  const { settings, setSettings } = usePanel();
  const { snap, load } = useActivity();
  const m = snap?.state;
  const d = snap?.diag;
  return (
    <div className="space-y-3" data-testid="activity-tab">
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <Button size="sm" variant={settings?.observe ? 'accent' : 'outline'} className="h-6" data-testid="observe-toggle"
          onClick={() => void setSettings({ observe: !settings?.observe })}>{settings?.observe ? 'Pause observation' : 'Start observing'}</Button>
        <Button size="sm" variant={settings?.suggestions ? 'accent' : 'outline'} className="h-6" data-testid="suggestions-toggle"
          onClick={() => void setSettings({ suggestions: !settings?.suggestions })}>Suggestions {settings?.suggestions ? 'on' : 'off'}</Button>
        <Button size="sm" variant="ghost" className="h-6" data-testid="activity-clear" onClick={() => void send({ type: 'ACTIVITY_CLEAR' }).then(load)}>Clear</Button>
        <Button size="sm" variant="ghost" className="ml-auto h-6" onClick={() => void load()}>Refresh</Button>
      </div>
      {d && (
        <div className="text-[11px] text-muted-foreground" data-testid="activity-diag">
          {d.inFlight ? 'analysing…' : 'idle'} · queued {d.queued} · sent {d.sent} Steps in {d.calls} calls{d.lastMs !== undefined ? ` · last ${(d.lastMs / 1000).toFixed(1)} s` : ''}
          {d.lastJudge && <> · {d.lastJudge}</>}{d.lastError && <span className="text-destructive"> · {d.lastError}</span>}
        </div>
      )}
      {!settings?.observe && !m?.activeTasks.length && !m?.recentCompleted.length && (
        <Empty>Observation is off. Turn it on to let the assistant notice repeated tasks and suggest widgets (Steps are redacted; sensitive sites are never observed).</Empty>
      )}
      <section className="space-y-1.5">
        <h4 className="m-0 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">What I think you're doing</h4>
        {m?.activeTasks.length ? m.activeTasks.map(t => <TaskRow key={t.id} t={t} testId="active-task" />) : <div className="text-xs text-muted-foreground">No active task.</div>}
      </section>
      <section className="space-y-1.5">
        <h4 className="m-0 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Suggestions</h4>
        {snap?.suggestions.length ? snap.suggestions.map(s => <SuggestionRow key={s.id} s={s} />) : <div className="text-xs text-muted-foreground">None yet.</div>}
      </section>
      <section className="space-y-1.5">
        <h4 className="m-0 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Patterns</h4>
        {m?.patterns.length ? m.patterns.map(p => (
          <div key={p.id} data-testid="pattern-row" className="rounded-md border px-2.5 py-1.5 text-xs">
            <span className="font-medium">{p.name}</span> <Badge variant="outline" data-testid="pattern-count">{p.instanceIds.length} completed</Badge>
            {m.dismissed.some(x => x.patternId === p.id) && <Badge variant="outline" className="ml-1">dismissed</Badge>}
            <div className="text-[11px] text-muted-foreground">{p.abstractSteps.join(' → ')}{p.automationIdea ? ` · idea: ${p.automationIdea}` : ''}</div>
          </div>
        )) : <div className="text-xs text-muted-foreground">No patterns yet.</div>}
      </section>
      <section className="space-y-1.5">
        <h4 className="m-0 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Recently completed</h4>
        {m?.recentCompleted.length ? [...m.recentCompleted].reverse().map(t => <TaskRow key={t.id} t={t} testId="completed-task" />) : <div className="text-xs text-muted-foreground">Nothing yet.</div>}
      </section>
    </div>
  );
}
