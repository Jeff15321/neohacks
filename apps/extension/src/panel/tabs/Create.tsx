import React, { useRef, useState } from 'react';
import { Button } from '../components/ui/button.js';
import { Empty, Textarea } from '../components/ui/primitives.js';
import { ApprovalCard } from '../components/WidgetCards.js';
import { send } from '../hooks/useBus.js';
import { usePanel } from '../app/state.js';

const CHIPS = ['Move into the toolbar', 'Make it collapsible', 'Show progress while it runs'];

/** Create: describe → generate → approval card(s) for not-yet-approved versions. */
export function CreateTab() {
  const { widgets, progress, setProgress, setError } = usePanel();
  const [input, setInput] = useState('');
  const busy = useRef(false);
  const pending = widgets.filter(w => !w.approved);

  const generate = async () => {
    const request = input.trim();
    if (!request || busy.current) return;
    busy.current = true; setError(''); setProgress({ stage: 'starting' });
    const r = await send({ type: 'GENERATE_WIDGET', request });
    if (!r.ok) { setError(r.error ?? 'generation failed'); setProgress(null); }
    busy.current = false;
  };

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex-1 space-y-3 overflow-auto">
        {pending.map(w => <ApprovalCard key={`${w.id}:${w.version}`} w={w} />)}
        {progress && !progress.widgetId && (
          <div data-testid="progress" className="shimmer rounded-lg border p-3 text-xs text-muted-foreground">Generating… {progress.stage}{progress.detail ? `: ${progress.detail}` : ''}</div>
        )}
        {pending.length === 0 && !progress && (
          <Empty>Describe a widget for the page you're on.<br />e.g. “Add a button that drafts replies to my 2 most recent unread emails.”</Empty>
        )}
      </div>
      <div className="space-y-1.5 border-t pt-2">
        <div className="flex flex-wrap gap-1">
          {CHIPS.map(c => <Button key={c} size="sm" variant="secondary" className="h-6 rounded-full text-[11px]" onClick={() => setInput(v => (v ? `${v} ${c.toLowerCase()}` : c))}>{c}</Button>)}
        </div>
        <Textarea id="req" placeholder="Describe the widget you want on this page…" value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void generate(); }} />
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">⌘/Ctrl + Enter</span>
          <Button id="gen-btn" variant="accent" disabled={!!progress} onClick={() => void generate()}>Generate</Button>
        </div>
      </div>
    </div>
  );
}
