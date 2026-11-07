import React, { useCallback, useEffect, useState } from 'react';
import type { BusLogEntry, LlmCallLog, NetInvokeResult, NetOpSummary } from '@app/contracts';
import { Button } from '../components/ui/button.js';
import { Badge, Disclosure } from '../components/ui/primitives.js';
import { send } from '../hooks/useBus.js';
import { cn, fmtTime } from '../lib/utils.js';

/**
 * Inspector: raw capture and AI interpretation shown separately (decision A).
 * Phase 0: Network ops, Bus log, LLM calls. Phase B adds Steps, run timelines, Export debug bundle.
 */
export function InspectorTab() {
  return (
    <div className="space-y-3">
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
  const [browserOnly, setBrowserOnly] = useState<NetOpSummary[]>([]);
  const [alive, setAlive] = useState<boolean | null>(null);
  const [replay, setReplay] = useState<Record<string, string>>({});
  const load = useCallback(() => {
    void send<{ ops?: NetOpSummary[]; probeAlive?: boolean; browserOnly?: NetOpSummary[] }>({ type: 'GET_NET_OPS' }).then(r => {
      setOps(r.ok ? r.ops ?? [] : []); setAlive(r.ok ? !!r.probeAlive : null); setBrowserOnly(r.ok ? r.browserOnly ?? [] : []);
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
  const tierVariant = (t?: string) => (t === 'verified' ? 'success' : t === 'replayed' ? 'default' : 'outline') as 'success' | 'default' | 'outline';
  return (
    <section data-testid="net-ops">
      <PaneHeader title="Network" testId="net-refresh" onRefresh={load}
        extra={alive === false ? <span className="text-[11px] text-warning">probe not seen — reload the page</span> : undefined} />
      {ops.length === 0 && <div className="text-xs text-muted-foreground">No requests captured yet — interact with the page, then Refresh.</div>}
      <div className="space-y-1">
        {ops.map(op => (
          <Disclosure key={op.id} title={
            <span className="flex min-w-0 items-center gap-1.5 font-mono text-[11px] text-foreground" data-op-id={op.id}>
              <b className={cn(op.method !== 'GET' && 'text-accent')}>{op.method}</b>
              <span className="truncate">{op.path}</span>
              <Badge variant={op.status && op.status < 400 ? 'success' : 'destructive'}>{op.status ?? (op.ok === false ? 'ERR' : '…')}</Badge>
              {op.replay && <Badge variant="outline">replay</Badge>}
              {op.confirmed === false && <Badge variant="warning">unconfirmed</Badge>}
              {op.tier && <Badge variant={tierVariant(op.tier)} data-testid="net-tier" title={op.tierEvidence}>{op.tier}</Badge>}
              {op.triggerText && <span className="truncate text-muted-foreground">← {op.triggerText}</span>}
            </span>
          }>
            <div className="space-y-1 text-[11px]">
              <div className="break-all text-muted-foreground">{op.url}</div>
              {op.analysis && (
                <div className="space-y-0.5 font-mono" data-testid="net-analysis">
                  <div>template <b>{op.analysis.templateKey}</b> · {op.analysis.captures} capture{op.analysis.captures === 1 ? '' : 's'}{op.stepId ? ` · step ${op.stepId}` : ''}{op.attribution ? ` · by ${op.attribution}` : ''}</div>
                  {op.analysis.tokenFields.length > 0 && <div>tokens: {op.analysis.tokenFields.join(', ')}</div>}
                  {op.analysis.paramFields.length > 0 && <div>params: {op.analysis.paramFields.join(', ')}</div>}
                  {op.analysis.dependsOn.map(d => <div key={d.field + d.opId}>depends: {d.field} ← {d.fromTemplate} .{d.path}</div>)}
                  {op.analysis.idempotencyHint && <div className="text-muted-foreground">{op.analysis.idempotencyHint}</div>}
                  {op.tierEvidence && <div className="text-muted-foreground">tier evidence: {op.tierEvidence}</div>}
                </div>
              )}
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
      {browserOnly.length > 0 && (
        <div className="mt-1.5 space-y-0.5 font-mono text-[10.5px] text-muted-foreground" data-testid="net-browser-only">
          <div className="font-sans text-[11px]">Browser-seen only (no body, not replayable):</div>
          {browserOnly.map(o => <div key={o.id} className="truncate">{o.method} {o.path} {o.status ?? ''}</div>)}
        </div>
      )}
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
