import { z } from 'zod';
import { msg, usMsg } from './_msg.js';
import { InvokeRequestSpec, NetDirectRequest, NetInvokeOverrides, NetRequestRecord, NetTrigger, NetVerifyEvidence } from '../net.js';

/** Owner: extension modules/net (+ content/netbridge, page/netprobe). */
export const panel = [
  msg('GET_NET_OPS', { tabId: z.number().optional() }),
  /** Full raw records for the target tab (debug/export — not redacted). */
  msg('GET_NET_RECORDS', { tabId: z.number().optional() }),
  msg('NET_REPLAY', { opId: z.string(), overrides: NetInvokeOverrides.optional(), tabId: z.number().optional() }),
] as const;

/** content script → SW */
export const page = [
  msg('WWA_NET_RECORD', { record: NetRequestRecord }),
  msg('WWA_GESTURE', { gesture: NetTrigger }),
  msg('WWA_NET_HELLO', { frameUrl: z.string(), patched: z.boolean().optional() }),
] as const;

/** SW → content script */
export const toContent = [
  msg('WWA_NET_INVOKE', { invokeId: z.string(), request: InvokeRequestSpec }),
  msg('WWA_NET_PING', {}),
] as const;

export const userScript = [
  usMsg('WIDGET_NET_OPS', {}),
  usMsg('WIDGET_NET_INVOKE', { opId: z.string(), overrides: NetInvokeOverrides.optional() }),
  usMsg('WIDGET_NET_REQUEST', { request: NetDirectRequest }),
  /** Widget run read back its success criterion after using op `opId` → template tier `verified` (doc §4 item 4). */
  usMsg('WIDGET_NET_REPORT_VERIFIED', { opId: z.string(), evidence: NetVerifyEvidence }),
] as const;

export const broadcast = [] as const;
