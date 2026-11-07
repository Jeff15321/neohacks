import React, { useEffect } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs.js';
import { Badge } from '../components/ui/primitives.js';
import { Button } from '../components/ui/button.js';
import { PanelProvider, usePanel } from './state.js';
import { CreateTab } from '../tabs/Create.js';
import { WidgetsTab } from '../tabs/Widgets.js';
import { InspectorTab } from '../tabs/Inspector.js';
import { RecordButton, RecordTab } from '../tabs/Record.js';
import { ActivityTab, SuggestionRouter } from '../tabs/Activity.js';
import { DataTab } from '../tabs/Data.js';

/** Panel tab shell. Each tab's body lives in tabs/<Name>.tsx (one owner per tab: Record → B, Activity → D, Data → A). */
const TABS: Array<{ id: string; label: string; Body: React.ComponentType }> = [
  { id: 'create', label: 'Create', Body: CreateTab },
  { id: 'widgets', label: 'Widgets', Body: WidgetsTab },
  { id: 'record', label: 'Record', Body: RecordTab },
  { id: 'inspector', label: 'Inspector', Body: InspectorTab },
  { id: 'activity', label: 'Activity', Body: ActivityTab },
  { id: 'data', label: 'Data', Body: DataTab },
];

function Header() {
  const { health, settings, setSettings } = usePanel();
  const ok = health?.backend === 'ok' && health.userScripts;
  return (
    <header className="flex items-center gap-2 border-b px-3 py-2">
      <span className="text-sm font-semibold tracking-tight">Widget AI</span>
      <Badge data-testid="health" variant={ok ? 'success' : health ? 'destructive' : 'outline'} title={health?.backendUrl}>
        {health ? `backend ${health.backend}${health.provider ? ` · ${health.provider}` : ''}` : '…'}
      </Badge>
      <div className="ml-auto flex items-center gap-1">
        <Button size="sm" variant={settings?.observe ? 'accent' : 'outline'} className="h-6" title="Passive observation (Phase D)"
          onClick={() => void setSettings({ observe: !settings?.observe })}>Observe {settings?.observe ? 'on' : 'off'}</Button>
        <RecordButton />
      </div>
    </header>
  );
}

function Shell() {
  const { health, error, setError, tab, setTab } = usePanel();
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => document.documentElement.classList.toggle('dark', mq.matches);
    apply(); mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);
  return (
    <div className="flex h-full flex-col">
      <SuggestionRouter />{/* Phase D: Accept on a suggestion → Create tab approval card */}
      <Header />
      {health && !health.userScripts && (
        <div className="m-3 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs">
          chrome.userScripts is unavailable. Open chrome://extensions → this extension's Details → enable <b>Allow User Scripts</b>, then reload.
        </div>
      )}
      {error && (
        <div data-testid="error" className="mx-3 mt-3 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
          <span className="flex-1 break-words">{error}</span>
          <button className="cursor-pointer border-0 bg-transparent text-destructive" onClick={() => setError('')}>✕</button>
        </div>
      )}
      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col p-3 pt-2">
        <TabsList>
          {TABS.map(t => <TabsTrigger key={t.id} value={t.id} data-testid={`tab-${t.id}`}>{t.label}</TabsTrigger>)}
        </TabsList>
        {TABS.map(t => (
          <TabsContent key={t.id} value={t.id} className="mt-3 min-h-0 overflow-auto"><t.Body /></TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

export function App() {
  return <PanelProvider><Shell /></PanelProvider>;
}
