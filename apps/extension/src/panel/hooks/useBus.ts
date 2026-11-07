import { useEffect, useRef } from 'react';
import type { PanelToSW, SWToPanel } from '@app/contracts';
import { BROADCAST_TYPES } from '@app/contracts';
import { newTraceId } from '@app/core/util';

/** Panel → SW request. User-initiated flows get a fresh traceId here so it propagates panel → SW → backend → llm_calls. */
export async function send<R = any>(msg: PanelToSW): Promise<R & { ok: boolean; error?: string; traceId?: string }> {
  const m = { traceId: newTraceId(), ...msg };
  try {
    return (await chrome.runtime.sendMessage(m)) ?? { ok: false, error: 'no response from service worker' };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e) } as R & { ok: boolean; error: string };
  }
}

/** Subscribe to SW → panel broadcasts. */
export function useBroadcast(handler: (msg: SWToPanel) => void) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const listener = (msg: { type?: string }) => { if (msg?.type && BROADCAST_TYPES.has(msg.type)) ref.current(msg as SWToPanel); };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);
}
