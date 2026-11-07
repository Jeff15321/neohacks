import React from 'react';
import { Button } from '../components/ui/button.js';
import { Badge, Disclosure } from '../components/ui/primitives.js';
import { useActivity } from './Activity.js';

/**
 * Phase D Inspector pane: the AI's interpretation of the Step stream, shown next to the raw capture (decision A):
 * active hypotheses (goal readings, confidence, cited Steps with roles, expectedNext), patterns, Tier-1 labels, and
 * the pipeline diagnostics (queue / last Judge verdict). Raw WorkingMemory JSON is one click away.
 */
export function HypothesesPane() {
  const { snap, load } = useActivity();
  const m = snap?.state;
  return (
    <div className="space-y-1.5" data-testid="hypotheses-pane">
      <div className="flex items-center gap-2">
        <h3 className="m-0 text-sm font-semibold">Hypotheses &amp; patterns</h3>
        <Badge variant="outline">{m ? `${m.activeTasks.length} active · ${m.patterns.length} patterns` : 'no state'}</Badge>
        <Button size="sm" variant="ghost" className="ml-auto h-6" data-testid="hyp-refresh" onClick={() => void load()}>Refresh</Button>
      </div>
      {snap?.diag.lastJudge && <div className="text-[11px] text-muted-foreground" data-testid="hyp-judge">last gate/Judge: {snap.diag.lastJudge}</div>}
      {m?.activeTasks.map(t => (
        <Disclosure key={t.id} testId="hypothesis" title={<span>{t.goal} <span className="text-muted-foreground">({Math.round(t.confidence * 100)}%)</span></span>}>
          <div className="space-y-0.5 text-[11px]">
            {!!t.alternativeGoals?.length && <div>alternative readings: {t.alternativeGoals.join(' | ')}</div>}
            <div>steps: {t.stepRefs.map(r => `#${r.seq} ${r.role}`).join(', ') || '—'}</div>
            {t.expectedNext && <div>expected next: {t.expectedNext}</div>}
            <div>slots: {JSON.stringify(t.slots)}</div>
          </div>
        </Disclosure>
      ))}
      {m?.patterns.map(p => (
        <Disclosure key={p.id} testId="pattern" title={<span>{p.name} <span className="font-mono text-muted-foreground">{p.id}</span> · {p.instanceIds.length} completed</span>}>
          <div className="space-y-0.5 text-[11px]">
            <div>abstract steps: {p.abstractSteps.join(' → ')}</div>
            <div>parameters: {p.parameters.map(x => `${x.name} (${x.io}, ${x.source})`).join(', ') || '—'}</div>
            <div>instances: {p.instanceIds.join(', ')}</div>
          </div>
        </Disclosure>
      ))}
      {!!snap?.semantic?.length && (
        <Disclosure title={`Tier-1 labels (${snap.semantic.length})`}>
          <ol className="m-0 pl-4 text-[11px]">{snap.semantic.map(s => <li key={s.seq}>#{s.seq} {s.verb} {s.object}{s.isNavigationOnly ? ' (nav)' : ''}</li>)}</ol>
        </Disclosure>
      )}
      {m && <Disclosure title="WorkingMemory JSON"><pre className="m-0 max-h-60 overflow-auto text-[10.5px]">{JSON.stringify(m, null, 1)}</pre></Disclosure>}
    </div>
  );
}
