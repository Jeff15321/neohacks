/**
 * Content script (ISOLATED world, all frames, document_idle).
 *   netbridge/  probe relay + gestures (every frame)
 *   context.ts  PageContext (top frame only)
 *   steps/      Step recorder (Phase B)      overlay/  REC pill, suggestion card, danger confirm (B/C/D)
 */
import { extractContext } from './context.js';
import { startNetBridge } from './netbridge/index.js';

startNetBridge();

if (window === window.top) {
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'WWA_GET_CONTEXT') { sendResponse(extractContext()); return; }
    if (msg?.type === 'WWA_PING') { sendResponse({ ok: true }); return; }
    return undefined;
  });
}
