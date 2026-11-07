import React, { useCallback, useEffect, useState } from 'react';
import type { BusLogEntry, LlmCallLog, NetInvokeResult, NetOpSummary, Step } from '@app/contracts';
import { redactStepForExport } from '@app/core/step-redact';
import { usePanel, type LogLine } from '../app/state.js';
import { Button } from '../components/ui/button.js';
import { Badge, Disclosure } from '../components/ui/primitives.js';
import { send } from '../hooks/useBus.js';
import { cn, fmtTime } from '../lib/utils.js';

/**
 * Inspector: raw capture and AI interpretation shown separately (decision A).
 * Phase 0: Network ops, Bus log, LLM calls. Phase B adds Steps, run timelines, Export debug bundle / trace.
 */
export function InspectorTab() {
  return (
    <div className="space-y-3">
      <ExportBar />
      <StepsPane />
      <NetworkPane />
      <BusPane />
      <LlmPane />
    </div>
  );
}

function PaneHeader({ title, onRefresh, testId, extra }: { title: string; onRefresh: () => void; testId: string; extra?: React.ReactNode }) {
  return (
    <div className="mb-1.5 flex items-center gap-2">
      <h4 className="m-0 text-xs font-semibold">{title}</h4>
      {extra}
      <Button size="sm" variant="ghost" className="ml-auto h-6" data-testid={testId} onClick={onRefresh}>Refresh</Button>
    </div>
  );
}

function NetworkPane() {
  const [ops, setOps] = useState<NetOpSummary[]>([]);
  const [alive, setAlive] = useState<boolean | null>(null);
  const [replay, setReplay] = useState<Record<string, string>>({});
  const load = useCallback(() => {
    void send<{ ops?: NetOpSummary[]; probeAlive?: boolean }>({ type: 'GET_NET_OPS' }).then(r => {
      setOps(r.ok ? r.ops ?? [] : []); setAlive(r.ok ? !!r.probeAlive : null);
    });
  }, []);
  useEffect(load, [load]);
  const doReplay = (op: NetOpSummary) => {
    setReplay(p => ({ ...p, [op.id]: 'replaying…' }));
    void send<{ result?: NetInvokeResult }>({ type: 'NET_REPLAY', opId: op.id }).then(r => {
      const res = r.result;
      setReplay(p => ({ ...p, [op.id]: !r.ok ? `failed: ${r.error}` : `${res?.status ?? '?'} ${res?.statusText ?? ''}${res?.bodyText ? ' — ' + res.bodyText.slice(0, 160) : ''}` }));
      load();
    });
  };
  return (
    <section data-testid="net-ops">
      <PaneHeader title="Network" testId="net-refresh" onRefresh={load}
        extra={alive === false ? <span className="text-[11px] text-warning">probe not seen — reload the page</span> : undefined} />
      {ops.length === 0 && <div className="text-xs text-muted-foreground">No requests captured yet — interact with the page, then Refresh.</div>}
      <div className="space-y-1">
        {ops.map(op => (
          <Disclosure key={op.id} title={
            <span className="flex min-w-0 items-center gap-1.5 font-mono text-[11px] text-foreground">
              <b className={cn(op.method !== 'GET' && 'text-accent')}>{op.method}</b>
              <span className="truncate">{op.path}</span>
              <Badge variant={op.status && op.status < 400 ? 'success' : 'destructive'}>{op.status ?? (op.ok === false ? 'ERR' : '…')}</Badge>
              {op.replay && <Badge variant="outline">replay</Badge>}
              {op.confirmed === false && <Badge variant="warning">unconfirmed</Badge>}
              {op.triggerText && <span className="truncate text-muted-foreground">← {op.triggerText}</span>}
            </span>
          }>
            <div className="space-y-1 text-[11px]">
              <div className="break-all text-muted-foreground">{op.url}</div>
              {op.requestBodyTemplate && <pre className="m-0 max-h-32 overflow-auto rounded bg-muted p-1.5 whitespace-pre-wrap">{op.requestBodyTemplate}</pre>}
              {op.responseBodySample && <pre className="m-0 max-h-32 overflow-auto rounded bg-muted p-1.5 whitespace-pre-wrap">{op.responseBodySample}</pre>}
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" disabled={!op.confirmed} onClick={() => doReplay(op)}>Replay</Button>
                {replay[op.id] && <span className="font-mono text-muted-foreground">{replay[op.id]}</span>}
              </div>
            </div>
          </Disclosure>
        ))}
      </div>
    </section>
  );
}

function BusPane() {
  const [entries, setEntries] = useState<BusLogEntry[]>([]);
  const load = useCallback(() => { void send<{ entries?: BusLogEntry[] }>({ type: 'GET_BUS_LOG', limit: 150 }).then(r => setEntries((r.entries ?? []).slice().reverse())); }, []);
  useEffect(load, [load]);
  return (
    <section data-testid="bus-log">
      <PaneHeader title="Bus log" testId="bus-refresh" onRefresh={load} />
      <div className="max-h-64 overflow-auto rounded-md border font-mono text-[10.5px]">
        {entries.map(e => (
          <div key={e.id} className={cn('flex gap-1.5 border-b px-2 py-0.5 last:border-0', !e.ok && 'bg-destructive/10')} title={e.error}>
            <span className="text-muted-foreground">{fmtTime(e.ts)}</span>
            <span className="w-16 shrink-0 text-muted-foreground">{e.channel}</span>
            <span className="truncate font-medium">{e.type}</span>
            <span className="ml-auto shrink-0 text-muted-foreground">{e.ms}ms</span>
            {e.traceId && <span className="shrink-0 text-muted-foreground">{e.traceId}</span>}
            {!e.ok && <span className="shrink-0 text-destructive">✗</span>}
          </div>
        ))}
        {entries.length === 0 && <div className="p-2 text-muted-foreground">empty</div>}
      </div>
    </section>
  );
}

function LlmPane() {
  const [calls, setCalls] = useState<LlmCallLog[]>([]);
  const [err, setErr] = useState('');
  const load = useCallback(() => {
    void send<{ calls?: LlmCallLog[] }>({ type: 'GET_LLM_CALLS', limit: 30 }).then(r => { setErr(r.ok ? '' : r.error ?? 'failed'); setCalls(r.calls ?? []); });
  }, []);
  useEffect(load, [load]);
  return (
    <section data-testid="llm-calls">
      <PaneHeader title="LLM calls" testId="llm-refresh" onRefresh={load} />
      {err && <div className="text-xs text-destructive">{err}</div>}
      <div className="space-y-1">
        {calls.map(c => (
          <Disclosure key={c.id} title={
            <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-foreground" data-testid="llm-call">
              <b className="font-mono">{c.stage}</b>
              <span className="truncate text-muted-foreground">{c.model}{c.effort ? ` · ${c.effort}` : ''}</span>
              <span className="text-muted-foreground">{c.latencyMs ?? '…'}ms</span>
              {c.parseOk === false && <Badge variant="destructive">parse ✗</Badge>}
              {c.error && <Badge variant="destructive">error</Badge>}
              <span className="ml-auto font-mono text-muted-foreground">{c.traceId}</span>
            </span>
          }>
            <div className="space-y-1 text-[11px]">
              {c.error && <div className="text-destructive">{c.error}</div>}
              <div className="text-muted-foreground">tokens in/out: {c.inputTokens ?? '–'} / {c.outputTokens ?? '–'} · provider {c.provider}</div>
              <div className="font-semibold">input</div>
              <pre className="m-0 max-h-48 overflow-auto rounded bg-muted p-1.5 whitespace-pre-wrap">{c.input.slice(0, 20000)}</pre>
              <div className="font-semibold">output</div>
              <pre className="m-0 max-h-48 overflow-auto rounded bg-muted p-1.5 whitespace-pre-wrap">{(c.output ?? '').slice(0, 20000)}</pre>
            </div>
          </Disclosure>
        ))}
        {calls.length === 0 && !err && <div className="text-xs text-muted-foreground">No LLM calls yet.</div>}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ Phase B: Steps + export

/** Everything needed to debug a run offline → one JSON file (decision A / Debuggability). */
export async function collectDebugBundle(widgets: ReturnType<typeof usePanel>['widgets'], logs: Record<string, LogLine[]>) {
  const [steps, rec, llm, bus] = await Promise.all([
    send<{ steps?: Step[] }>({ type: 'GET_STEPS', limit: 300 }),
    send<Record<string, unknown>>({ type: 'REC_GET' }),
    send<{ calls?: LlmCallLog[] }>({ type: 'GET_LLM_CALLS', limit: 100 }),
    send<{ entries?: BusLogEntry[] }>({ type: 'GET_BUS_LOG', limit: 400 }),
  ]);
  const busEntries = bus.entries ?? [];
  return {
    kind: 'wwa-debug-bundle', version: 1, exportedAt: new Date().toISOString(),
    extensionVersion: chrome.runtime.getManifest?.().version,
    steps: (steps.steps ?? []).map(redactStepForExport),
    recording: rec.ok ? { session: rec.session ?? null, steps: ((rec.steps as Step[] | undefined) ?? []).map(redactStepForExport), semantic: rec.semantic ?? {}, spec: rec.spec ?? null, widgetId: rec.widgetId } : null,
    llmCalls: llm.calls ?? [],
    busLog: busEntries,
    widgets: widgets.map(w => ({
      id: w.id, name: w.name, version: w.version, status: w.status, approved: w.approved, origin: w.origin,
      matchPatterns: w.matchPatterns, grants: w.grants, traceId: w.traceId, lastError: w.lastError, code: w.code, spec: w.spec, thread: w.thread,
    })),
    runTimeline: widgets.map(w => ({
      widgetId: w.id, version: w.version,
      logs: logs[w.id] ?? [],
      bus: busEntries.filter(e => e.type.startsWith('WIDGET_') && (!w.traceId || e.traceId === w.traceId || e.channel === 'userScript')),
    })),
  };
}

function download(name: string, data: unknown) {
  const json = JSON.stringify(data, null, 2);
  (window as unknown as { __wwaLastExport?: string }).__wwaLastExport = json; // test hook
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

function ExportBar() {
  const { widgets, logs, setError } = usePanel();
  const [busy, setBusy] = useState(false);
  const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');
  const exportBundle = async () => {
    setBusy(true);
    try { download(`wwa-debug-${stamp()}.json`, await collectDebugBundle(widgets, logs)); } catch (e) { setError(String((e as Error)?.message ?? e)); }
    setBusy(false);
  };
  const exportTrace = async () => {
    const rec = await send<{ steps?: Step[]; semantic?: unknown; spec?: unknown; session?: { id: string } | null }>({ type: 'REC_GET' });
    const steps = rec.steps?.length ? rec.steps : (await send<{ steps?: Step[] }>({ type: 'GET_STEPS', limit: 300 })).steps ?? [];
    download(`wwa-trace-${stamp()}.json`, {
      kind: 'wwa-trace', version: 1, name: rec.session?.id ?? 'trace', exportedAt: new Date().toISOString(),
      steps: steps.map(redactStepForExport), semantic: rec.semantic ?? {}, spec: rec.spec ?? null,
      labels: { note: 'add hand labels here (see tests/traces/README.md)' },
    });
  };
  return (
    <div className="flex items-center gap-1.5">
      <Button size="sm" variant="outline" data-testid="export-bundle" disabled={busy} onClick={() => void exportBundle()}>Export debug bundle</Button>
      <Button size="sm" variant="ghost" data-testid="export-trace" onClick={() => void exportTrace()}>Export trace</Button>
    </div>
  );
}

function StepsPane() {
  const [steps, setSteps] = useState<Step[]>([]);
  const load = useCallback(() => { void send<{ steps?: Step[] }>({ type: 'GET_STEPS', limit: 60 }).then(r => setSteps((r.steps ?? []).slice().reverse())); }, []);
  useEffect(load, [load]);
  return (
    <section data-testid="steps-log">
      <PaneHeader title="Steps (raw capture)" testId="steps-refresh" onRefresh={load} />
      {steps.length === 0 && <div className="text-xs text-muted-foreground">No Steps yet — start a recording (or turn Observe on) and interact with the page.</div>}
      <div className="space-y-1">
        {steps.map(s => (
          <Disclosure key={s.id} title={
            <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-foreground" data-testid="step-log-row">
              <span className="font-mono text-muted-foreground">#{s.seq}</span>
              <b>{s.action.kind}</b>
              <span className="truncate">{s.action.accessibleName ?? s.action.target?.accessibleName ?? s.action.key ?? ''}</span>
              {!s.settled && <Badge variant="warning">{s.settle?.reason ?? 'unsettled'}</Badge>}
              {[...s.effects.liveRegionText, ...(s.lateEffects?.liveRegionText ?? [])].map(t => <Badge key={t} variant="success">{t}</Badge>)}
              <span className="ml-auto shrink-0 text-muted-foreground">{s.tEnd - s.tStart}ms</span>
            </span>
          }>
            <pre className="m-0 max-h-64 overflow-auto rounded bg-muted p-1.5 text-[10.5px] whitespace-pre-wrap">{JSON.stringify(s, null, 1).slice(0, 12000)}</pre>
          </Disclosure>
        ))}
      </div>
    </section>
  );
}
