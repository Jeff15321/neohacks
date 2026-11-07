/**
 * Network probe bridge (runs in EVERY frame, isolated world). The MAIN-world probe in the same frame posts
 * {source:'wwa-net'} messages to its OWN window (never to window.top — doc §4 1a); we relay records/hello
 * to the SW (which learns the frame from `sender.frameId`). Invoke requests from the SW are relayed into the
 * page in the top frame only.
 */
const isTop = window === window.top;

function describeTarget(el: Element | null): { target: string; text?: string } {
  if (!el) return { target: 'unknown' };
  const e = el as HTMLElement;
  const bits = [e.tagName.toLowerCase()];
  if (e.id) bits.push('#' + e.id);
  const cls = (typeof e.className === 'string' ? e.className : '').split(/\s+/).filter(Boolean).slice(0, 3);
  if (cls.length) bits.push('.' + cls.join('.'));
  const role = e.getAttribute?.('role'); if (role) bits.push(`[role=${role}]`);
  const al = e.getAttribute?.('aria-label'); if (al) bits.push(`[aria-label="${al.slice(0, 40)}"]`);
  const text = (e.innerText ?? e.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 60) || undefined;
  return { target: bits.join('').slice(0, 400), text };
}

const send = (msg: unknown) => { try { void chrome.runtime.sendMessage(msg).catch(() => {}); } catch { /* extension reloaded */ } };

/**
 * Step attribution hook (doc §4 item 2). The Step recorder (Phase B: content/steps) registers a provider returning
 * the id of the currently open Step; gestures and requests started while it is open carry that stepId (primary
 * attribution — the SW falls back to the 6 s gesture window when absent).
 */
let stepProvider: (() => string | undefined) | null = null;
const currentStep = (): string | undefined => { try { const s = stepProvider?.(); return s ? String(s).slice(0, 80) : undefined; } catch { return undefined; } };
/** request id → stepId at `start` time (records arrive after the response, possibly in a later step). */
const startSteps = new Map<string, string>();
export const netAttribution = {
  setStepProvider(fn: (() => string | undefined) | null) { stepProvider = fn; },
};

let lastGesture = { kind: '', target: '', ts: 0 };
function reportGesture(kind: 'click' | 'submit' | 'keydown', ev: Event) {
  const now = Date.now();
  const el = (ev.target as Element)?.closest?.('button, [role="button"], a, [role="link"], input, [contenteditable], [tabindex], form') ?? (ev.target as Element);
  const { target, text } = describeTarget(el);
  // Dedupe repeated events on the same element; different targets are never throttled (fast UIs fire back-to-back).
  if (kind === lastGesture.kind && target === lastGesture.target && now - lastGesture.ts < 400) return;
  lastGesture = { kind, target, ts: now };
  // resolve the step after the event's other capture listeners (the Step recorder may open a step for this gesture)
  setTimeout(() => {
    const stepId = currentStep();
    send({ type: 'WWA_GESTURE', gesture: { kind, target, text, ts: now, ...(stepId ? { stepId } : {}) } });
  }, 0);
}

const pendingInvokes = new Map<string, (r: unknown) => void>();
let probeSeen = false;
const pageOrigin = location.origin === 'null' ? '*' : location.origin;

/**
 * In-flight request tracking for this frame (probe `start` → `record` pairs), consumed by the Step settle machine
 * (Phase B: content/steps). Requests that never complete are dropped after 30 s.
 */
type NetActivity = { kind: 'start' | 'end'; id: string; method: string; url: string; ts: number; status?: number };
const inflight = new Map<string, number>();
const listeners = new Set<(e: NetActivity) => void>();
export const netActivity = {
  inflight(): number {
    const now = Date.now();
    for (const [id, ts] of inflight) if (now - ts > 30_000) inflight.delete(id);
    return inflight.size;
  },
  subscribe(fn: (e: NetActivity) => void): () => void { listeners.add(fn); return () => listeners.delete(fn); },
};
const notify = (e: NetActivity) => { for (const fn of listeners) { try { fn(e); } catch { /* listener bug */ } } };

export function startNetBridge() {
  document.addEventListener('click', e => reportGesture('click', e), true);
  document.addEventListener('submit', e => reportGesture('submit', e), true);
  document.addEventListener('keydown', e => { if ((e as KeyboardEvent).key === 'Enter') reportGesture('keydown', e); }, true);

  window.addEventListener('message', (ev) => {
    if (ev.source !== window) return; // only our own frame's probe
    const d = ev.data as { source?: string; kind?: string; record?: unknown; frameUrl?: string; patched?: boolean; invokeId?: string; result?: unknown } | null;
    if (!d || typeof d !== 'object' || d.source !== 'wwa-net') return;
    probeSeen = true;
    if (d.kind === 'start') {
      const s = d as unknown as NetActivity;
      inflight.set(String(s.id), Date.now());
      const step = currentStep();
      if (step) { startSteps.set(String(s.id), step); if (startSteps.size > 200) startSteps.delete(startSteps.keys().next().value!); }
      notify({ kind: 'start', id: String(s.id), method: String(s.method), url: String(s.url), ts: Number(s.ts) });
    } else if (d.kind === 'record') {
      const r = d.record as { id?: string; method?: string; url?: string; startTs?: number; status?: number; replay?: boolean } | undefined;
      if (r?.id) { inflight.delete(r.id); notify({ kind: 'end', id: r.id, method: String(r.method), url: String(r.url), ts: Date.now(), status: r.status }); }
      // stepId is stamped here (isolated world), never taken from the page-posted payload
      const rec = { ...(d.record as Record<string, unknown>) };
      delete rec.stepId;
      const step = r?.id ? (startSteps.get(r.id) ?? undefined) : undefined;
      if (r?.id) startSteps.delete(r.id);
      if (step) rec.stepId = step;
      send({ type: 'WWA_NET_RECORD', record: rec });
    }
    else if (d.kind === 'hello' || d.kind === 'pong') send({ type: 'WWA_NET_HELLO', frameUrl: String(d.frameUrl ?? location.href), patched: d.patched });
    else if (d.kind === 'result' && isTop && d.invokeId) {
      const resolve = pendingInvokes.get(d.invokeId);
      if (resolve) { pendingInvokes.delete(d.invokeId); resolve(d.result); }
    }
  });

  // The probe's hello at document_start predates this script (document_idle); ping it so presence is detected.
  try { window.postMessage({ source: 'wwa-ext', kind: 'ping' }, pageOrigin); } catch { /* opaque origin */ }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'WWA_NET_PING') { sendResponse({ ok: true, alive: probeSeen }); return; }
    if (msg?.type === 'WWA_NET_INVOKE' && isTop) {
      const invokeId: string = msg.invokeId;
      const timer = setTimeout(() => {
        if (pendingInvokes.delete(invokeId)) sendResponse({ ok: false, error: 'netprobe invoke timed out' });
      }, 35_000);
      pendingInvokes.set(invokeId, (result) => { clearTimeout(timer); sendResponse({ ok: true, result }); });
      try {
        window.postMessage({ source: 'wwa-ext', kind: 'invoke', invokeId, request: msg.request }, pageOrigin);
      } catch (e) {
        clearTimeout(timer); pendingInvokes.delete(invokeId);
        sendResponse({ ok: false, error: String((e as Error)?.message ?? e) });
      }
      return true;
    }
    return undefined;
  });
}
