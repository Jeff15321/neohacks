import type { WidgetRecord } from '@app/contracts';
import { storage } from '../../platform/index.js';

/** Storage keys owned by modules/widgets. */
const KEY = 'wwa_widgets';
export const widgetStorageKey = (widgetId: string, key: string) => `wwa_store_${widgetId}_${key}`;

export class WidgetStore {
  private map = new Map<string, WidgetRecord>();
  readonly ready: Promise<void>;
  constructor() {
    this.ready = storage.local.get<WidgetRecord[]>(KEY).then(list => { for (const w of list ?? []) this.map.set(w.id, w); });
  }
  get(id: string) { return this.map.get(id); }
  list() { return [...this.map.values()].sort((a, b) => b.createdAt - a.createdAt); }
  async put(w: WidgetRecord) { this.map.set(w.id, w); await this.persist(); }
  async delete(id: string) { this.map.delete(id); await this.persist(); }
  persist() { return storage.local.set(KEY, [...this.map.values()]); }
}
