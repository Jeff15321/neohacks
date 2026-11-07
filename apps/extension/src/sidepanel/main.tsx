import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { PanelToSW, SWToPanel, WidgetRecord } from '@app/shared';

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

  const run = (id: string) => send({ type: 'RUN_WIDGET', widgetId: id }).then(r => { if (!r?.ok) setError(r?.error ?? 'run failed'); });
  const remove = (id: string) => send({ type: 'REMOVE_WIDGET', widgetId: id }).then(() => setWidgets(prev => prev.filter(w => w.id !== id)));
  const repair = (id: string) => { setError(''); setBusy(true); busyRef.current = true; setProgress('repair:regenerating'); send({ type: 'REPAIR_WIDGET', widgetId: id }).then(r => { if (!r?.ok) { setError(r?.error ?? 'repair failed'); setBusy(false); busyRef.current = false; setProgress(''); } }); };

  return <>
    <header>Widget AI <span className="be">{health ? `backend:${health.backend} · userScripts:${health.userScripts ? 'on' : 'OFF — enable "Allow User Scripts" in extension details'}` : '…'}</span></header>
    {health && !health.userScripts && <div className="card err">chrome.userScripts is unavailable. Go to chrome://extensions → this extension's Details → enable <b>Allow User Scripts</b>, then reload.</div>}
    <div id="widgets">
      {error && <div className="card err">{error}</div>}
      {progress && <div className="card"><em>Generating… {progress}</em></div>}
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
