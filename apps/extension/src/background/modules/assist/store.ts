import { ASSIST_LIMITS, type WidgetRun } from '@app/contracts';
import { storage } from '../../platform/index.js';

/** Storage key owned by modules/assist: recent widget runs (timeline + narrative + learned branches). */
const KEY = 'wwa_runs';

export class RunStore {
  private map = new Map<string, WidgetRun>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  readonly ready: Promise<void>;
  constructor() {
    this.ready = storage.local.get<WidgetRun[]>(KEY).then(list => { for (const r of list ?? []) this.map.set(r.id, r); }).catch(() => {});
  }
  get(id: string) { return this.map.get(id); }
  list(widgetId?: string, limit = 20) {
    return [...this.map.values()].filter(r => !widgetId || r.widgetId === widgetId).sort((a, b) => b.startedAt - a.startedAt).slice(0, limit);
  }
  put(r: WidgetRun) {
    this.map.set(r.id, r);
    if (this.map.size > ASSIST_LIMITS.RUNS_KEPT) {
      const old = [...this.map.values()].sort((a, b) => a.startedAt - b.startedAt).slice(0, this.map.size - ASSIST_LIMITS.RUNS_KEPT);
      for (const o of old) this.map.delete(o.id);
    }
    this.persistSoon();
  }
  private persistSoon() {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; void storage.local.set(KEY, [...this.map.values()]); }, 300);
  }
}
