import React, { useCallback, useEffect, useState } from 'react';
import type { DataCollectionInfo, DataDoc } from '@app/contracts';
import { Button } from '../components/ui/button.js';
import { Badge, Empty } from '../components/ui/primitives.js';
import { send } from '../hooks/useBus.js';
import { usePanel } from '../app/state.js';
import { cn, fmtTime } from '../lib/utils.js';

/** Owner: Phase A. The user's WidgetAI.db: collections → docs (pretty JSON, delete one, clear collection, export JSON). */
export function DataTab() {
  const { setError } = usePanel();
  const [collections, setCollections] = useState<DataCollectionInfo[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [docs, setDocs] = useState<DataDoc[]>([]);
  const [next, setNext] = useState<string | undefined>();
  const [confirmClear, setConfirmClear] = useState(false);

  const loadCollections = useCallback(async () => {
    const r = await send<{ collections?: DataCollectionInfo[] }>({ type: 'DATA_LIST_COLLECTIONS' });
    if (!r.ok) { setError(r.error ?? 'could not load data'); setCollections([]); return []; }
    const list = r.collections ?? [];
    setCollections(list);
    return list;
  }, [setError]);

  const loadDocs = useCallback(async (collection: string, after?: string) => {
    const r = await send<{ docs?: DataDoc[]; next?: string }>({ type: 'DATA_LIST', collection, limit: 100, ...(after ? { after } : {}) });
    if (!r.ok) { setError(r.error ?? 'could not load documents'); return; }
    setDocs(prev => after ? [...prev, ...(r.docs ?? [])] : (r.docs ?? []));
    setNext(r.next);
  }, [setError]);

  const refresh = useCallback(async () => {
    const list = await loadCollections();
    const keep = selected && list.some(c => c.name === selected) ? selected : list[0]?.name ?? null;
    setSelected(keep);
    if (keep) await loadDocs(keep); else { setDocs([]); setNext(undefined); }
  }, [loadCollections, loadDocs, selected]);

  useEffect(() => { void refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const select = (name: string) => { setSelected(name); setConfirmClear(false); void loadDocs(name); };

  const del = async (d: DataDoc) => {
    const r = await send({ type: 'DATA_DELETE', collection: d.collection, id: d.id });
    if (!r.ok) { setError(r.error ?? 'delete failed'); return; }
    setDocs(prev => prev.filter(x => x.id !== d.id));
    void loadCollections();
  };

  const clear = async () => {
    if (!selected) return;
    if (!confirmClear) { setConfirmClear(true); return; }
    setConfirmClear(false);
    const r = await send({ type: 'DATA_CLEAR', collection: selected });
    if (!r.ok) { setError(r.error ?? 'clear failed'); return; }
    await refresh();
  };

  /** Export: the selected collection, or (all=true) every collection, as one JSON file. */
  const exportJson = async (all: boolean) => {
    const names = all ? (collections ?? []).map(c => c.name) : selected ? [selected] : [];
    const out: Record<string, DataDoc[]> = {};
    for (const name of names) {
      const acc: DataDoc[] = [];
      let after: string | undefined;
      do {
        const r = await send<{ docs?: DataDoc[]; next?: string }>({ type: 'DATA_LIST', collection: name, limit: 200, ...(after ? { after } : {}) });
        if (!r.ok) { setError(r.error ?? 'export failed'); return; }
        acc.push(...(r.docs ?? []));
        after = r.next;
      } while (after);
      out[name] = acc;
    }
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), collections: out }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = all ? 'widget-data.json' : `widget-data-${selected}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5_000);
  };

  return (
    <div className="space-y-3" data-testid="data-tab">
      <div className="flex items-center gap-2">
        <h4 className="m-0 text-xs font-semibold">Your data</h4>
        <span className="text-[11px] text-muted-foreground">saved by widgets, shared between them</span>
        <Button size="sm" variant="ghost" className="ml-auto h-6" data-testid="data-refresh" onClick={() => void refresh()}>Refresh</Button>
      </div>

      {collections === null ? <Empty>Loading…</Empty> : collections.length === 0 ? (
        <Empty>No data yet. Widgets with the “data” permission save documents here (e.g. a “Save movie” button).</Empty>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5" data-testid="data-collections">
            {collections.map(c => (
              <button key={c.name} type="button" data-testid="data-collection" data-name={c.name} onClick={() => select(c.name)}
                className={cn('inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[11.5px]',
                  c.name === selected ? 'border-accent bg-accent/10 text-foreground' : 'bg-transparent text-muted-foreground hover:text-foreground')}>
                {c.name}<Badge variant="outline">{c.count}</Badge>
              </button>
            ))}
          </div>

          {selected && (
            <section data-testid="data-docs" className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-xs font-semibold">{selected}</span>
                <span data-testid="data-doc-count" className="text-[11px] text-muted-foreground">{docs.length}{next ? '+' : ''} doc{docs.length === 1 ? '' : 's'}</span>
                <div className="ml-auto flex gap-1">
                  <Button size="sm" variant="outline" className="h-6" data-testid="data-export" onClick={() => void exportJson(false)}>Export JSON</Button>
                  <Button size="sm" variant="ghost" className="h-6" data-testid="data-export-all" onClick={() => void exportJson(true)}>Export all</Button>
                  <Button size="sm" variant={confirmClear ? 'destructive' : 'ghost'} className="h-6" data-testid="data-clear" onClick={() => void clear()}>
                    {confirmClear ? `Confirm: delete all ${docs.length}${next ? '+' : ''}` : 'Clear collection'}
                  </Button>
                </div>
              </div>
              {docs.length === 0 && <div className="text-xs text-muted-foreground">This collection is empty.</div>}
              {docs.map(d => (
                <div key={d.id} data-testid="data-doc" data-id={d.id} className="rounded-md border">
                  <div className="flex items-center gap-2 border-b px-2 py-1">
                    <span className="truncate font-mono text-[11px]">{d.id}</span>
                    <span className="text-[10.5px] text-muted-foreground" title={`created ${new Date(d.createdAt).toLocaleString()}`}>updated {fmtTime(d.updatedAt)}</span>
                    <Button size="sm" variant="ghost" className="ml-auto h-6 text-destructive" data-testid="data-delete" onClick={() => void del(d)}>Delete</Button>
                  </div>
                  {/* untrusted content: rendered as text only */}
                  <pre className="m-0 max-h-48 overflow-auto px-2 py-1.5 text-[11px] leading-snug whitespace-pre-wrap">{JSON.stringify(d.data, null, 2)}</pre>
                </div>
              ))}
              {next && <Button size="sm" variant="outline" onClick={() => void loadDocs(selected, next)}>Load more</Button>}
            </section>
          )}
        </>
      )}
    </div>
  );
}
