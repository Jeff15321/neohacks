import React from 'react';
import { Empty } from '../components/ui/primitives.js';
import { WidgetCard } from '../components/WidgetCards.js';
import { usePanel } from '../app/state.js';

export function WidgetsTab() {
  const { widgets, progress } = usePanel();
  const installed = widgets.filter(w => w.approved);
  return (
    <div className="space-y-3">
      {progress?.widgetId && <div className="shimmer rounded-lg border p-3 text-xs text-muted-foreground">Updating widget… {progress.detail}</div>}
      {installed.map(w => <WidgetCard key={w.id} w={w} />)}
      {installed.length === 0 && <Empty>No installed widgets yet. Generate one in Create and approve it.</Empty>}
    </div>
  );
}
