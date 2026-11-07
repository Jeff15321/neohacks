import { z } from 'zod';
import * as widgets from './widgets.js';
import * as net from './net.js';
import * as system from './system.js';
import * as record from './record.js';
import * as data from './data.js';
import * as assist from './assist.js';
import * as flow from './flow.js';
import * as jobs from './jobs.js';
import * as observe from './observe.js';

export { Settings, DEFAULT_SETTINGS, BusLogEntry, HealthInfo } from './system.js';

/**
 * Boundary unions. Each domain file owns its messages; add new ones there, not here.
 * Boundaries: panel → SW, content → SW ("page"), SW → content, user script → SW, SW → panel (broadcast).
 */
export const PanelToSW = z.discriminatedUnion('type', [
  ...system.panel, ...widgets.panel, ...net.panel,
  ...record.panel, ...data.panel, ...assist.panel, ...flow.panel, ...jobs.panel, ...observe.panel,
]);
export type PanelToSW = z.infer<typeof PanelToSW>;

export const PageToSW = z.discriminatedUnion('type', [
  ...net.page,
  ...record.page, ...data.page, ...assist.page, ...flow.page, ...jobs.page, ...observe.page,
]);
export type PageToSW = z.infer<typeof PageToSW>;

export const SWToContent = z.discriminatedUnion('type', [
  ...system.toContent, ...net.toContent,
  ...record.toContent, ...data.toContent, ...assist.toContent, ...flow.toContent, ...jobs.toContent, ...observe.toContent,
]);
export type SWToContent = z.infer<typeof SWToContent>;

export const UserScriptMsg = z.discriminatedUnion('type', [
  ...widgets.userScript, ...net.userScript,
  ...record.userScript, ...data.userScript, ...assist.userScript, ...flow.userScript, ...jobs.userScript, ...observe.userScript,
]);
export type UserScriptMsg = z.infer<typeof UserScriptMsg>;

export const SWToPanel = z.discriminatedUnion('type', [
  ...system.broadcast, ...widgets.broadcast, ...net.broadcast,
  ...record.broadcast, ...data.broadcast, ...assist.broadcast, ...flow.broadcast, ...jobs.broadcast, ...observe.broadcast,
]);
export type SWToPanel = z.infer<typeof SWToPanel>;

export type MsgOf<U extends { type: string }, T extends U['type']> = Extract<U, { type: T }>;

/** Every reply over the bus: `{ok:true, ...data}` or `{ok:false, error}`. */
export type BusReply = { ok: true; [k: string]: unknown } | { ok: false; error: string };

/** Types that only ever flow SW → panel (the SW ignores them if they loop back). */
export const BROADCAST_TYPES: ReadonlySet<string> = new Set(SWToPanel.options.map(o => o.shape.type.value));
