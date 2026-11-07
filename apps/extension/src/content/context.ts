import type { Landmark, PageContext } from '@app/contracts';

/** PageContext extraction (ported from MVP content/context.ts). Top frame only. */

const visible = (el: Element): boolean => {
  const r = (el as HTMLElement).getBoundingClientRect?.();
  return !!r && r.width > 2 && r.height > 2 && r.bottom > 0 && r.top < innerHeight && (el as HTMLElement).offsetParent !== null;
};

const toLandmark = (el: Element): Landmark => {
  const e = el as HTMLElement;
  const r = e.getBoundingClientRect?.();
  const dataAttrs: Record<string, string> = {};
  for (const a of Array.from(e.attributes ?? [])) {
    if (a.name.startsWith('data-') && Object.keys(dataAttrs).length < 3) dataAttrs[a.name] = a.value.slice(0, 40);
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

/** Indented tag#id.class tree (depth ≤5, ≤4000 chars). Reused by Steps (region skeletons). */
export function skeletonOf(root: Element, maxChars = 4000, maxDepth = 5): string {
  let out = '';
  const walk = (el: Element, depth: number) => {
    if (out.length > maxChars || depth > maxDepth) return;
    const e = el as HTMLElement;
    if (e.id?.startsWith('wwa-')) return; // never describe our own UI
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
  walk(root, 0);
  return out;
}

export function extractContext(): PageContext {
  const landmarkSel = 'header, nav, main, aside, footer, [role="banner"], [role="navigation"], [role="main"], [role="toolbar"], [role="search"], [role="complementary"], [role="list"], [role="listitem"], [role="row"], [role="grid"], [role="gridcell"], form, tr, [class*="toolbar" i], [id*="toolbar" i], [class*="header" i], [class*="row" i], [class*="item" i], [aria-label]';
  const landmarks: Landmark[] = [];
  const seen = new Set<Element>();
  for (const el of document.querySelectorAll(landmarkSel)) {
    if (seen.has(el) || landmarks.length >= 90 || !visible(el)) continue;
    seen.add(el); landmarks.push(toLandmark(el));
  }
  const insertionCandidates: Landmark[] = [];
  for (const el of document.querySelectorAll('[role="toolbar"], header, nav, [class*="toolbar" i], [id*="toolbar" i], [role="banner"], main, [role="main"]')) {
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
  return {
    url: location.href, origin: location.origin, title: document.title,
    landmarks, insertionCandidates, interactive,
    textSample: (document.body?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 3000),
    domSkeleton: skeletonOf(skeletonRoot),
  };
}
