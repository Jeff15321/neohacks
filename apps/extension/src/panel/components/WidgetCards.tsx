import React, { useState } from 'react';
import type { WidgetRecord } from '@app/contracts';
import { Button } from './ui/button.js';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Disclosure, Input } from './ui/primitives.js';
import { send } from '../hooks/useBus.js';
import { usePanel } from '../app/state.js';
import { fmtTime } from '../lib/utils.js';
import { RunTimeline } from './RunTimeline.js';

const GRANT_TEXT: Record<string, string> = {
  inference: 'Send page text you act on to the AI to write or summarize',
  log: 'Show progress messages in this panel',
  storage: 'Remember its own settings in this browser',
  network: "Re-send this site's own requests (same site only, with your login)",
  data: 'Read and save your personal data (only the collections listed below)',
  flow: 'Open and act on the other sites listed below, using your login there (Phase F)',
};

const STATUS_VARIANT: Record<string, 'default' | 'accent' | 'success' | 'warning' | 'destructive'> = {
  ready: 'default', running: 'accent', completed: 'success', failed: 'destructive', generating: 'accent',
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge data-testid="widget-status" variant={STATUS_VARIANT[status] ?? 'default'}>{status}</Badge>;
}

const sites = (w: WidgetRecord) => w.matchPatterns.map(p => p.replace(/^\*:\/\//, '').replace(/\/\*$/, '')).join(', ');
/** Phase F: every origin a bundle touches (home + parts), each needing explicit approval. */
const partSites = (w: WidgetRecord) => (w.parts ?? []).map(p => ({ role: p.role, sites: p.matchPatterns.map(m => m.replace(/^\*:\/\//, '').replace(/\/\*$/, '')).join(', '), handlers: p.handlers ?? [] }));

/** Approval card: plain-language plan, sites, grants, consequential actions, code (collapsed). */
export function ApprovalCard({ w }: { w: WidgetRecord }) {
  const { setTab, setError } = usePanel();
  const [busy, setBusy] = useState(false);
  const approve = async () => {
    setBusy(true); setError('');
    setTab('widgets');
    const r = await send({ type: 'APPROVE_WIDGET', widgetId: w.id });
    if (!r.ok) setError(r.error ?? 'approve failed');
    setBusy(false);
  };
  const reject = async () => { await send({ type: 'REMOVE_WIDGET', widgetId: w.id }); };
  return (
    <Card data-testid="approval-card">
      <CardHeader>
        <CardTitle>{w.name}<Badge variant="outline">v{w.version}</Badge></CardTitle>
        <CardDescription>{w.description}</CardDescription>
        {w.changeSummary && <CardDescription className="text-accent">Changed: {w.changeSummary}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-2.5">
        {!!w.plan?.length && (
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">What it will do</div>
            <ol className="m-0 list-decimal space-y-0.5 pl-4 text-[12.5px]">{w.plan.map((s, i) => <li key={i}>{s}</li>)}</ol>
          </div>
        )}
        <div className="text-xs"><span className="text-muted-foreground">Sites: </span>{sites(w)}</div>
        {!!w.parts?.length && ( /* Phase F: cross-site bundle */
          <div data-testid="bundle-sites" className="rounded-md border border-accent/40 p-2 text-xs">
            <div className="mb-0.5 font-semibold">Also acts on other sites:</div>
            <ul className="m-0 list-disc pl-4">{partSites(w).map(p => <li key={p.role} data-testid="bundle-part"><span className="font-mono">{p.sites}</span> — {p.role}{p.handlers.length ? ` (${p.handlers.join(', ')})` : ''}</li>)}</ul>
          </div>
        )}
        {w.grants.length > 0 && (
          <ul className="m-0 list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">{w.grants.map(g => <li key={g}>{GRANT_TEXT[g] ?? g}</li>)}</ul>
        )}
        {!!w.collections?.length && ( /* Phase A */
          <div data-testid="stores-data" className="text-xs"><span className="text-muted-foreground">Stores data in: </span><span className="font-mono">{w.collections.join(', ')}</span></div>
        )}
        {!!w.consequentialActions?.length && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
            Needs your confirmation at runtime: {w.consequentialActions.join('; ')}
          </div>
        )}
        <div className="flex flex-wrap gap-1.5">
          <Button variant="accent" data-testid="approve" disabled={busy} onClick={approve}>Approve &amp; install</Button>
          <Button variant="outline" onClick={() => { setTab('widgets'); }}>Modify</Button>
          <Button variant="ghost" data-testid="reject" onClick={reject}>Reject</Button>
        </div>
        <Disclosure title="View code"><pre className="m-0 max-h-72 overflow-auto text-[11px] leading-snug whitespace-pre-wrap">{w.code}</pre></Disclosure>
        {(w.parts ?? []).map(p => <Disclosure key={p.role} title={`View code: ${p.role}`}><pre className="m-0 max-h-72 overflow-auto text-[11px] leading-snug whitespace-pre-wrap">{p.code}</pre></Disclosure>)}
      </CardContent>
    </Card>
  );
}

/** Installed widget: status, run, conversational edit, auto-fix, logs, version thread. */
export function WidgetCard({ w }: { w: WidgetRecord }) {
  const { logs, setError, setProgress } = usePanel();
  const [edit, setEdit] = useState('');
  const call = async (p: Promise<{ ok: boolean; error?: string }>) => { const r = await p; if (!r.ok) setError(r.error ?? 'failed'); };
  const repair = (instruction?: string) => {
    setError(''); setProgress({ stage: 'llm', detail: instruction ? 'editing widget' : 'repairing widget', widgetId: w.id });
    void call(send({ type: 'REPAIR_WIDGET', widgetId: w.id, instruction })).finally(() => setProgress(null));
  };
  const lines = logs[w.id] ?? [];
  return (
    <Card data-testid="widget-card">
      <CardHeader>
        <CardTitle>{w.name}<StatusBadge status={w.status} /><Badge variant="outline">v{w.version}</Badge></CardTitle>
        <CardDescription>{w.description}</CardDescription>
        <CardDescription className="font-mono text-[10.5px]">{sites(w)} · {w.grants.join(', ') || 'no grants'}{w.collections?.length ? ` · data: ${w.collections.join(', ')}` : ''}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {w.status === 'failed' && w.lastError && <div className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">{w.lastError}</div>}
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="accent" data-testid="run" disabled={w.status === 'running'} onClick={() => void call(send({ type: 'RUN_WIDGET', widgetId: w.id }))}>
            {w.status === 'running' ? 'Running…' : 'Run'}
          </Button>
          {w.status === 'failed' && <Button size="sm" variant="outline" onClick={() => repair()}>Auto-fix</Button>}
          <Button size="sm" variant="ghost" onClick={() => void call(send({ type: 'REMOVE_WIDGET', widgetId: w.id }))}>Remove</Button>
        </div>
        <form className="flex gap-1.5" onSubmit={e => { e.preventDefault(); if (edit.trim()) { repair(edit.trim()); setEdit(''); } }}>
          <Input data-testid="edit-input" placeholder='Edit: e.g. "move the button into the toolbar"' value={edit} onChange={e => setEdit(e.target.value)} />
          <Button size="sm" variant="outline" type="submit" disabled={!edit.trim()}>Edit</Button>
        </form>
        <RunTimeline widgetId={w.id} />
        {lines.length > 0 && (
          <div data-testid="widget-log" className="max-h-40 overflow-auto rounded-md bg-muted p-2 font-mono text-[10.5px] leading-relaxed">
            {lines.map((l, i) => <div key={i}><span className="text-muted-foreground">{fmtTime(l.t)}</span> {l.text}</div>)}
          </div>
        )}
        {!!w.thread?.length && (
          <Disclosure title={`Conversation (${w.thread.length})`}>
            <div className="space-y-1 text-xs">{w.thread.map((t, i) => (
              <div key={i}><Badge variant={t.role === 'user' ? 'outline' : 'accent'}>{t.role === 'user' ? 'you' : `v${t.version ?? '?'}`}</Badge> {t.text}</div>
            ))}</div>
          </Disclosure>
        )}
        <Disclosure title="Code"><pre className="m-0 max-h-72 overflow-auto text-[11px] leading-snug whitespace-pre-wrap">{w.code}</pre></Disclosure>
      </CardContent>
    </Card>
  );
}
