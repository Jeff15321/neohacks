import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { PanelToSW, SWToPanel, WidgetRecord, NetOpSummary, NetInvokeResult } from '@app/shared';

interface LogLine { t: number; text: string; }

const send = (msg: PanelToSW) => chrome.runtime.sendMessage(msg);

function App() {
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [widgets, setWidgets] = useState<WidgetRecord[]>([]);
  const [logs, setLogs] = useState<Record<string, LogLine[]>>({});
  const [progress, setProgress] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [showCode, setShowCode] = useState<Record<string, boolean>>({});
  const [health, setHealth] = useState<{ userScripts: boolean; backend: string; backendUrl: string } | null>(null);
  const [netOpen, setNetOpen] = useState(false);
  const [netOps, setNetOps] = useState<NetOpSummary[]>([]);
  const [netAlive, setNetAlive] = useState<boolean | null>(null);
  const [netDetail, setNetDetail] = useState<Record<string, boolean>>({});
  const [netReplay, setNetReplay] = useState<Record<string, string>>({});
  const busyRef = useRef(false);

  const pushLog = (widgetId: string, text: string) =>
    setLogs(prev => ({ ...prev, [widgetId]: [...(prev[widgetId] ?? []), { t: Date.now(), text }].slice(-60) }));

  useEffect(() => {
    send({ type: 'PANEL_READY' }).then(r => { if (r?.widgets) setWidgets(r.widgets); });
    send({ type: 'GET_HEALTH' }).then(r => { if (r?.health) setHealth(r.health); });
    const listener = (msg: SWToPanel) => {
      switch (msg.type) {
        case 'GENERATION_PROGRESS': setProgress(`${msg.stage}: ${msg.detail ?? ''}`); break;
        case 'WIDGET_GENERATED':
          setWidgets(prev => [msg.widget, ...prev.filter(w => w.id !== msg.widget.id)]);
          setBusy(false); busyRef.current = false; setProgress('');
          break;
        case 'WIDGET_STATUS':
          setWidgets(prev => prev.map(w => w.id === msg.widgetId ? { ...w, status: msg.status } : w));
          if (msg.log) pushLog(msg.widgetId, msg.log);
          break;
        case 'WIDGET_LIST': setWidgets(msg.widgets); break;
        case 'ERROR': setError(msg.message); setBusy(false); busyRef.current = false; setProgress(''); break;
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  const generate = () => {
    if (!input.trim() || busyRef.current) return;
    setBusy(true); busyRef.current = true; setError(''); setProgress('starting');
    send({ type: 'GENERATE_WIDGET', request: input.trim() }).then(r => {
      if (!r?.ok) { setError(r?.error ?? 'generation failed'); setBusy(false); busyRef.current = false; setProgress(''); }
    });
  };

  const loadNet = () => {
    send({ type: 'GET_NET_OPS' }).then(r => {
      if (r?.ok) { setNetOps(r.ops ?? []); setNetAlive(!!r.probeAlive); }
      else if (r?.error) setNetOps([]);
    });
  };
  const toggleNet = () => { const next = !netOpen; setNetOpen(next); if (next) loadNet(); };
  const replay = (op: NetOpSummary) => {
    setNetReplay(p => ({ ...p, [op.id]: 'replaying…' }));
    send({ type: 'NET_REPLAY', opId: op.id }).then(r => {
      const res = r?.result as NetInvokeResult | undefined;
      const txt = !r?.ok ? `failed: ${r?.error ?? 'replay failed'}`
        : `${res?.status ?? '?'} ${res?.statusText ?? ''}${res?.ok ? '' : ' (HTTP error)'}${res?.bodyText ? ' — ' + String(res.bodyText).slice(0, 160) : ''}`;
      setNetReplay(p => ({ ...p, [op.id]: txt }));
      loadNet(); // the replay itself is recorded — refresh the list
    });
  };
  const run = (id: string) => send({ type: 'RUN_WIDGET', widgetId: id }).then(r => { if (!r?.ok) setError(r?.error ?? 'run failed'); });
  const remove = (id: string) => send({ type: 'REMOVE_WIDGET', widgetId: id }).then(() => setWidgets(prev => prev.filter(w => w.id !== id)));
  const repair = (id: string, instruction?: string) => { setError(''); setBusy(true); busyRef.current = true; setProgress('repair:regenerating'); send({ type: 'REPAIR_WIDGET', widgetId: id, instruction }).then(r => { if (!r?.ok) { setError(r?.error ?? 'repair failed'); setBusy(false); busyRef.current = false; setProgress(''); } }); };
  const [editText, setEditText] = useState<Record<string, string>>({});

  return <>
    <header>Widget AI <span className="be">{health ? `backend:${health.backend} · userScripts:${health.userScripts ? 'on' : 'OFF — enable "Allow User Scripts" in extension details'}` : '…'}</span></header>
    {health && !health.userScripts && <div className="card err">chrome.userScripts is unavailable. Go to chrome://extensions → this extension's Details → enable <b>Allow User Scripts</b>, then reload.</div>}
    <div id="widgets">
      {error && <div className="card err">{error}</div>}
      {progress && <div className="card"><em>Generating… {progress}</em></div>}
      <div className="card net">
        <div className="row" style={{ marginTop: 0, alignItems: 'center' }}>
          <button onClick={toggleNet} id="net-toggle">{netOpen ? '▾' : '▸'} Network activity</button>
          {netOpen && <button onClick={loadNet} id="net-refresh">Refresh</button>}
          {netOpen && netAlive === false && <span className="meta" style={{ margin: 0 }}>probe not seen — reload the page</span>}
        </div>
        {netOpen && <>
          {netOps.length === 0 && <div className="hint" style={{ padding: '6px 0 0' }}>No requests captured yet — interact with the page (click, save, navigate), then Refresh.</div>}
          {netOps.map(op => (
            <div className="netop" key={op.id}>
              <div className="netline" onClick={() => setNetDetail(p => ({ ...p, [op.id]: !p[op.id] }))}>
                <b className={op.method === 'GET' ? '' : 'mut'}>{op.method}</b>
                <span className="mono path">{op.path}</span>
                <span className={`st ${op.status && op.status < 400 ? 'ok' : 'bad'}`}>{op.status ?? (op.ok === false ? 'ERR' : '…')}</span>
                {op.replay && <span className="badge">replay</span>}
                {op.triggerText && <span className="trig">← {op.triggerText}</span>}
              </div>
              {netDetail[op.id] && <div className="netdetail">
                <div className="meta">full url: {op.url}</div>
                {op.requestBodyTemplate && <><div className="meta">request body:</div><pre>{op.requestBodyTemplate}</pre></>}
                {op.responseBodySample && <><div className="meta">response:</div><pre>{op.responseBodySample}</pre></>}
                <div className="row">
                  <button onClick={() => replay(op)}>Replay</button>
                  {netReplay[op.id] && <span className="meta mono" style={{ margin: 0 }}>{netReplay[op.id]}</span>}
                </div>
              </div>}
            </div>
          ))}
        </>}
      </div>
      {widgets.map(w => (
        <div className="card" key={w.id}>
          <h3>{w.name}<span className={`status ${w.status}`}>{w.status}</span></h3>
          <div className="meta">{w.description}</div>
          <div className="meta">origin: {w.origin} · grants: {w.grants.join(', ') || 'none'} · {w.matchPatterns.join(' ')}</div>
          <div className="row">
            <button className="primary" disabled={w.status === 'running'} onClick={() => run(w.id)}>{w.status === 'running' ? 'Running…' : 'Approve & Run'}</button>
            <button onClick={() => setShowCode(p => ({ ...p, [w.id]: !p[w.id] }))}>{showCode[w.id] ? 'Hide code' : 'Review code'}</button>
            {w.status === 'failed' && <button onClick={() => repair(w.id)}>Auto-fix</button>}
            <button onClick={() => remove(w.id)}>Remove</button>
          </div>
          <div className="row">
            <input style={{ flex: 1, font: 'inherit', padding: '4px 8px', border: '1px solid #dadce0', borderRadius: 8 }}
              placeholder="Edit: e.g. insert the reply into Gmail's actual reply composer"
              value={editText[w.id] ?? ''} onChange={e => setEditText(p => ({ ...p, [w.id]: e.target.value }))} />
            <button disabled={!editText[w.id]?.trim()} onClick={() => { repair(w.id, editText[w.id].trim()); setEditText(p => ({ ...p, [w.id]: '' })); }}>Edit</button>
          </div>
          {showCode[w.id] && <pre>{w.code}</pre>}
          {(logs[w.id]?.length ?? 0) > 0 && <div className="log">{logs[w.id].map((l, i) => <div key={i}>{new Date(l.t).toLocaleTimeString()} {l.text}</div>)}</div>}
        </div>
      ))}
      {widgets.length === 0 && !progress && <div className="hint">Describe a widget to add to this page.<br/>e.g. “Add a button that drafts replies to my 2 most recent unread emails.”</div>}
    </div>
    <div id="composer">
      <textarea id="req" placeholder="Describe the widget you want on this page…" value={input} onChange={e => setInput(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) generate(); }} />
      <button className="primary" id="gen-btn" disabled={busy} onClick={generate}>Generate</button>
    </div>
  </>;
}

createRoot(document.getElementById('root')!).render(<App />);
