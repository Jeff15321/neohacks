import React, { useEffect, useState } from 'react';
import type { FlowRun } from '@app/contracts';
import { Button } from './ui/button.js';
import { Badge } from './ui/primitives.js';
import { send, useBroadcast } from '../hooks/useBus.js';
import { fmtTime } from '../lib/utils.js';

const VARIANT: Record<string, 'default' | 'accent' | 'success' | 'destructive'> = { pending: 'accent', running: 'accent', succeeded: 'success', failed: 'destructive', cancelled: 'default' };

/** Phase F: cross-site flow runs of one widget (status, timeline, evidence link, cancel). */
export function FlowRuns({ widgetId }: { widgetId: string }) {
  const [runs, setRuns] = useState<FlowRun[]>([]);
  useEffect(() => { void send<{ runs: FlowRun[] }>({ type: 'GET_FLOW_RUNS' }).then(r => r.ok && setRuns(r.runs ?? [])); }, [widgetId]);
  useBroadcast(m => {
    if (m.type !== 'FLOW_RUN_UPDATE' || m.run.widgetId !== widgetId) return;
    setRuns(prev => [m.run, ...prev.filter(r => r.runId !== m.run.runId)].sort((a, b) => b.createdAt - a.createdAt));
  });
  const mine = runs.filter(r => r.widgetId === widgetId).slice(0, 5);
  if (!mine.length) return null;
  return (
    <div data-testid="flow-runs" className="space-y-1 rounded-md border p-2 text-xs">
      <div className="font-semibold">Cross-site runs</div>
      {mine.map(r => {
        const ev = (r.result as { evidence?: { url?: string; id?: string } } | undefined)?.evidence;
        const active = r.status === 'pending' || r.status === 'running';
        return (
          <div key={r.runId} data-testid="flow-run" className="flex flex-wrap items-center gap-1.5">
            <Badge variant={VARIANT[r.status] ?? 'default'}>{r.status}</Badge>
            <span className="font-mono">{r.role}.{r.handler}</span>
            <span className="text-muted-foreground">{fmtTime(r.createdAt)} · {(r.events ?? []).map(e => e.event).join(' → ')}</span>
            {ev?.url && /^https?:/.test(ev.url) && <a href={ev.url} target="_blank" rel="noreferrer" className="text-accent underline">{ev.id ?? 'result'}</a>}
            {r.error && <span className="text-destructive">{r.error}</span>}
            {active && <Button size="sm" variant="outline" data-testid="flow-cancel" onClick={() => void send({ type: 'CANCEL_FLOW_RUN', runId: r.runId })}>Cancel</Button>}
          </div>
        );
      })}
    </div>
  );
}
