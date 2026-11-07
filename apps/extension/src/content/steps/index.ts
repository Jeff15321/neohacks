/** Step pipeline + REC pill wiring for the content script (top frame). Owner: Phase B. */
import { startStepRecorder } from './recorder.js';
import { setRecPill } from '../overlay/rec-pill.js';

const send = (msg: unknown) => { try { return chrome.runtime.sendMessage(msg).catch(() => undefined); } catch { return Promise.resolve(undefined); } };

type RecState = { capture: boolean; recording: boolean; stepCount?: number };

export function startSteps() {
  const rec = startStepRecorder();
  const apply = (s: RecState) => {
    rec.setCapture(!!s.capture);
    setRecPill(!!s.recording, { stepCount: s.stepCount, onStop: () => void send({ type: 'WWA_REC_STOP' }) });
  };
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'WWA_REC_STATE') { apply(msg as RecState); sendResponse({ ok: true }); return; }
    if (msg?.type === 'WWA_STEPS_FLUSH') { void rec.flush().then(() => sendResponse({ ok: true })); return true; }
    return undefined;
  });
  void send({ type: 'WWA_REC_QUERY' }).then((r) => { if (r && (r as { ok?: boolean }).ok) apply(r as RecState); });
}
