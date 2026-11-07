import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { HealthInfo, Settings, WidgetRecord } from '@app/contracts';
import { send, useBroadcast } from '../hooks/useBus.js';

export interface LogLine { t: number; text: string; }

export interface PanelState {
  widgets: WidgetRecord[];
  logs: Record<string, LogLine[]>;
  progress: { stage: string; detail?: string; widgetId?: string } | null;
  error: string;
  health: HealthInfo | null;
  settings: Settings | null;
  tab: string;
  setTab: (t: string) => void;
  setError: (e: string) => void;
  setProgress: (p: PanelState['progress']) => void;
  refreshWidgets: () => Promise<void>;
  setSettings: (patch: Partial<Settings>) => Promise<void>;
}

const Ctx = createContext<PanelState | null>(null);
export const usePanel = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePanel outside provider');
  return v;
};

export function PanelProvider({ children }: { children: React.ReactNode }) {
  const [widgets, setWidgets] = useState<WidgetRecord[]>([]);
  const [logs, setLogs] = useState<Record<string, LogLine[]>>({});
  const [progress, setProgress] = useState<PanelState['progress']>(null);
  const [error, setError] = useState('');
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [settings, setSettingsState] = useState<Settings | null>(null);
  const [tab, setTab] = useState('create');

  const refreshWidgets = useCallback(async () => {
    const r = await send<{ widgets?: WidgetRecord[] }>({ type: 'LIST_WIDGETS' });
    if (r.ok && r.widgets) setWidgets(r.widgets);
  }, []);

  useEffect(() => {
    void send<{ widgets?: WidgetRecord[] }>({ type: 'PANEL_READY' }).then(r => { if (r.widgets) setWidgets(r.widgets); });
    void send<{ health?: HealthInfo }>({ type: 'GET_HEALTH' }).then(r => { if (r.health) setHealth(r.health); });
    void send<{ settings?: Settings }>({ type: 'GET_SETTINGS' }).then(r => { if (r.settings) setSettingsState(r.settings); });
  }, []);

  useBroadcast(msg => {
    switch (msg.type) {
      case 'GENERATION_PROGRESS': setProgress({ stage: msg.stage, detail: msg.detail, widgetId: msg.widgetId }); break;
      case 'WIDGET_GENERATED':
        setWidgets(prev => [msg.widget, ...prev.filter(w => w.id !== msg.widget.id)]);
        setProgress(null);
        break;
      case 'WIDGET_STATUS':
        setWidgets(prev => prev.map(w => (w.id === msg.widgetId ? { ...w, status: msg.status, lastError: msg.status === 'failed' && msg.log ? msg.log : w.lastError } : w)));
        if (msg.log) setLogs(prev => ({ ...prev, [msg.widgetId]: [...(prev[msg.widgetId] ?? []), { t: Date.now(), text: msg.log! }].slice(-80) }));
        break;
      case 'WIDGET_LIST': setWidgets(msg.widgets); break;
      case 'SETTINGS_CHANGED': setSettingsState(msg.settings); break;
      case 'ERROR': setError(msg.message); setProgress(null); break;
    }
  });

  const setSettings = useCallback(async (patch: Partial<Settings>) => {
    const r = await send<{ settings?: Settings }>({ type: 'SET_SETTINGS', patch });
    if (r.settings) setSettingsState(r.settings);
  }, []);

  const value = useMemo<PanelState>(() => ({
    widgets, logs, progress, error, health, settings, tab, setTab, setError, setProgress, refreshWidgets, setSettings,
  }), [widgets, logs, progress, error, health, settings, tab, refreshWidgets, setSettings]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
