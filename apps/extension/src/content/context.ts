import type { Landmark, PageContext } from '@app/shared';

const visible = (el: Element): boolean => {
  const r = (el as HTMLElement).getBoundingClientRect?.();
  return !!r && r.width > 2 && r.height > 2 && r.bottom > 0 && r.top < innerHeight && (el as HTMLElement).offsetParent !== null;
};

const toLandmark = (el: Element): Landmark => {
  const e = el as HTMLElement;
  const r = e.getBoundingClientRect?.();
  const dataAttrs: Record<string, string> = {};
  for (const a of Array.from(e.attributes ?? [])) {
    if (a.name.startsWith('data-') && Object.keys(dataAttrs).length < 3) {
      dataAttrs[a.name] = a.value.slice(0, 40);
    }
  }
  return {
    tag: e.tagName.toLowerCase(),
    id: e.id || undefined,
    ...(Object.keys(dataAttrs).length ? { dataAttrs } : {}),
    classes: (typeof e.className === 'string' ? e.className : '').split(/\s+/).filter(Boolean).slice(0, 6).join(' ') || undefined,
    role: e.getAttribute?.('role') ?? undefined,
    ariaLabel: e.getAttribute?.('aria-label') ?? undefined,
    text: (e.innerText ?? e.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 120) || undefined,
    rect: r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : undefined,
  };
};

function extractContext(): PageContext {
  const url = location.href;
  const landmarkSel = 'header, nav, main, aside, footer, [role="banner"], [role="navigation"], [role="main"], [role="toolbar"], [role="search"], [role="complementary"], [role="list"], [role="listitem"], [role="row"], [role="grid"], [role="gridcell"], form, tr, [class*="toolbar" i], [id*="toolbar" i], [class*="header" i], [class*="row" i], [class*="item" i], [aria-label]';
  const landmarks: Landmark[] = [];
  const seen = new Set<Element>();
  for (const el of document.querySelectorAll(landmarkSel)) {
    if (seen.has(el) || landmarks.length >= 90 || !visible(el)) continue;
    seen.add(el); landmarks.push(toLandmark(el));
  }
  const candidateSel = '[role="toolbar"], header, nav, [class*="toolbar" i], [id*="toolbar" i], [role="banner"], main, [role="main"]';
  const insertionCandidates: Landmark[] = [];
  for (const el of document.querySelectorAll(candidateSel)) {
    if (insertionCandidates.length >= 12 || !visible(el)) continue;
    insertionCandidates.push(toLandmark(el));
  }
  const interactive: Landmark[] = [];
  for (const el of document.querySelectorAll('button, [role="button"], a[href], input, [contenteditable="true"], [role="link"]')) {
    if (interactive.length >= 40 || !visible(el)) continue;
    const l = toLandmark(el);
    l.text = (l.ariaLabel || l.text || (el as HTMLInputElement).placeholder || '').slice(0, 80);
    interactive.push(l);
  }
  const skeletonRoot = document.querySelector('main, #app, [role="main"], #content, .app, body') ?? document.body;
  const skeleton = (() => {
    let out = '';
    const walk = (el: Element, depth: number) => {
      if (out.length > 4000 || depth > 5) return;
      const e = el as HTMLElement;
      const bits = [e.tagName.toLowerCase()];
      if (e.id) bits.push('#' + e.id);
      const cls = (typeof e.className === 'string' ? e.className : '').split(/\s+/).filter(Boolean).slice(0, 4);
      if (cls.length) bits.push('.' + cls.join('.'));
      if (e.getAttribute?.('role')) bits.push(`[role=${e.getAttribute('role')}]`);
      if (e.getAttribute?.('aria-label')) bits.push(`[aria-label="${e.getAttribute('aria-label')}"]`);
      if (e.isContentEditable) bits.push('[contenteditable]');
      const own = [...e.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent?.trim()).filter(Boolean).join(' ').slice(0, 40);
      out += '  '.repeat(depth) + bits.join('') + (own ? ` "${own}"` : '') + '\n';
      for (const c of e.children) walk(c, depth + 1);
    };
    walk(skeletonRoot, 0);
    return out;
  })();
  const textSample = (document.body?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 3000);
  return {
    url, origin: location.origin, title: document.title,
    landmarks, insertionCandidates, textSample, interactive, domSkeleton: skeleton,
  };
}

// ---------------------------------------------------------------------------
// Network probe bridge — the MAIN-world netprobe posts {source:'wwa-net'}
// messages; we relay records/gesture hellos to the service worker, and relay
// invoke requests from the SW back into the page.
// ---------------------------------------------------------------------------

/** Summarize a gesture target as `tag#id.cls[role][aria-label] "text"`. */
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
  return { target: bits.join(''), text };
}

let lastGesture = { kind: '', target: '', ts: 0 };
function reportGesture(kind: 'click' | 'submit' | 'keydown', ev: Event) {
  const now = Date.now();
  const el = (ev.target as Element)?.closest?.('button, [role="button"], a, [role="link"], input, [contenteditable], [tabindex], form') ?? (ev.target as Element);
  const { target, text } = describeTarget(el);
  // Dedupe repeated events on the same element (double-fires, rapid re-clicks);
  // different targets are never throttled — fast UIs fire actions back-to-back.
  if (kind === lastGesture.kind && target === lastGesture.target && now - lastGesture.ts < 400) return;
  lastGesture = { kind, target, ts: now };
  try { chrome.runtime.sendMessage({ type: 'WWA_GESTURE', gesture: { kind, target, text, ts: now } }); } catch {}
}
document.addEventListener('click', e => reportGesture('click', e), true);
document.addEventListener('submit', e => reportGesture('submit', e), true);
document.addEventListener('keydown', e => { if ((e as KeyboardEvent).key === 'Enter') reportGesture('keydown', e); }, true);

// Pending invoke requests: invokeId -> resolve. Results arrive via postMessage.
const pendingInvokes = new Map<string, (r: unknown) => void>();
let probeSeen = false;

// The probe's hello at document_start predates this script (document_idle);
// ping it so presence is still detected on every page load.
try { window.postMessage({ source: 'wwa-ext', kind: 'ping' }, location.origin); } catch {}

window.addEventListener('message', (ev) => {
  const d = ev.data as { source?: string; kind?: string } | null;
  if (!d || typeof d !== 'object' || d.source !== 'wwa-net') return;
  probeSeen = true;
  if (d.kind === 'record') {
    try { chrome.runtime.sendMessage({ type: 'WWA_NET_RECORD', record: (d as any).record }); } catch {}
  } else if (d.kind === 'hello' || d.kind === 'pong') {
    try { chrome.runtime.sendMessage({ type: 'WWA_NET_HELLO', frameUrl: (d as any).frameUrl }); } catch {}
  } else if (d.kind === 'result') {
    const resolve = pendingInvokes.get((d as any).invokeId);
    if (resolve) { pendingInvokes.delete((d as any).invokeId); resolve((d as any).result); }
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'WWA_GET_CONTEXT') { sendResponse(extractContext()); return; }
  if (msg?.type === 'WWA_PING') { sendResponse({ ok: true }); return; }
  if (msg?.type === 'WWA_NET_PING') { sendResponse({ ok: true, alive: probeSeen }); return; }
  if (msg?.type === 'WWA_NET_INVOKE') {
    const invokeId: string = msg.invokeId;
    const timer = setTimeout(() => {
      if (pendingInvokes.delete(invokeId)) sendResponse({ ok: false, error: 'netprobe invoke timed out' });
    }, 35_000);
    pendingInvokes.set(invokeId, (result) => {
      clearTimeout(timer);
      sendResponse({ ok: true, result });
    });
    try {
      window.postMessage({ source: 'wwa-ext', kind: 'invoke', invokeId, request: msg.request }, location.origin);
    } catch (e) {
      clearTimeout(timer); pendingInvokes.delete(invokeId);
      sendResponse({ ok: false, error: String((e as Error)?.message ?? e) });
    }
    return true; // async response
  }
});
export {};
