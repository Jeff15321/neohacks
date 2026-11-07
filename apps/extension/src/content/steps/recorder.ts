/**
 * Step recorder (doc §1.2, content script, top frame). Turns meaningful DOM events into actions, runs the pure
 * settle machine from @app/core over DOM mutations / in-flight requests / URL changes, and sends settled Steps to
 * the SW (which assigns the global `seq`). Only active while the SW says `capture:true` (recording or observe flag).
 *
 * Imports only `@app/core/<subpath>` (never the root) to keep content.js small.
 */
import type { LocatorBundle, StepActionKind, StepDraft, StepLateEffects } from '@app/contracts';
import { SettleMachine, isSignificantMutation, type ClosedStep, type RegionLite } from '@app/core/settle';
import { buildLocatorBundle, isStableClass } from '@app/core/locators';
import { redactTypedValue, type FieldInfo } from '@app/core/step-redact';
import { hashValue } from '@app/core/lineage';
import { skeletonOf } from '../context.js';
import { netActivity } from '../netbridge/index.js';

interface Action {
  kind: StepActionKind;
  target?: LocatorBundle;
  accessibleName?: string;
  role?: string;
  landmarkPath?: string;
  valuePreview?: string;
  key?: string;
  valueHash?: string;
}

const send = (msg: unknown) => {
  try { return chrome.runtime.sendMessage(msg).catch(() => undefined); } catch { return Promise.resolve(undefined); }
};

const OWN_UI = '[id^="wwa-"]';
const inOwnUi = (n: Node | null): boolean => {
  const el = n?.nodeType === 1 ? (n as Element) : n?.parentElement ?? null;
  if (!el) return false;
  if (el.closest?.(OWN_UI)) return true;
  const root = el.getRootNode?.();
  return root instanceof ShadowRoot && !!(root.host as Element)?.closest?.(OWN_UI);
};
const isVisible = (el: Element | null): boolean => {
  if (!el || !(el as HTMLElement).getBoundingClientRect) return false;
  const r = (el as HTMLElement).getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return false;
  const cs = getComputedStyle(el);
  return cs.display !== 'none' && cs.visibility !== 'hidden';
};
const isEditable = (el: Element | null): el is HTMLElement =>
  !!el && ((el as HTMLElement).isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

const INTERACTIVE = 'a, button, input, select, textarea, summary, label, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="checkbox"], [role="radio"], [role="option"], [role="row"], [role="switch"], [role="treeitem"], [contenteditable="true"], [tabindex]:not([tabindex="-1"]), tr[data-legacy-message-id]';

function shortCssPath(el: Element): string {
  const parts: string[] = [];
  let cur: Element | null = el;
  for (let depth = 0; cur && cur !== document.body && depth < 4; depth++) {
    let p = cur.tagName.toLowerCase();
    const cls = [...cur.classList].filter(isStableClass).slice(0, 2);
    if (cls.length) p += '.' + cls.map(c => CSS.escape(c)).join('.');
    const parent: Element | null = cur.parentElement;
    if (parent) {
      const same = [...parent.children].filter(c => c.tagName === cur!.tagName && (!cls.length || cls.every(k => c.classList.contains(k))));
      if (same.length > 1) p += `:nth-of-type(${[...parent.children].filter(c => c.tagName === cur!.tagName).indexOf(cur) + 1})`;
    }
    parts.unshift(p);
    try { if (document.querySelectorAll(parts.join(' > ')).length === 1) break; } catch { break; }
    cur = parent;
  }
  return parts.join(' > ');
}

function landmarkPath(el: Element): string | undefined {
  const out: string[] = [];
  let cur: Element | null = el.parentElement;
  while (cur && out.length < 3) {
    const role = cur.getAttribute('role');
    const lab = cur.getAttribute('aria-label');
    if (role && /^(main|navigation|toolbar|grid|dialog|region|banner|complementary|form|list|listbox|menu|tablist)$/.test(role)) out.unshift(lab ? `${role}[${lab.slice(0, 30)}]` : role);
    else if (/^(MAIN|NAV|HEADER|FOOTER|FORM|DIALOG|ASIDE)$/.test(cur.tagName)) out.unshift(cur.tagName.toLowerCase());
    cur = cur.parentElement;
  }
  return out.length ? out.join(' > ') : undefined;
}

function accessibleName(el: Element): string | undefined {
  const e = el as HTMLElement;
  const al = e.getAttribute('aria-label');
  if (al) return al.trim().slice(0, 120);
  const lb = e.getAttribute('aria-labelledby');
  if (lb) { const t = lb.split(/\s+/).map(id => document.getElementById(id)?.textContent ?? '').join(' ').trim(); if (t) return t.slice(0, 120); }
  if ((e as HTMLInputElement).labels?.[0]) return (e as HTMLInputElement).labels![0].textContent?.trim().slice(0, 120);
  const ph = e.getAttribute('placeholder') ?? e.getAttribute('title');
  if (ph) return ph.slice(0, 120);
  const text = (e.innerText ?? e.textContent ?? '').trim().replace(/\s+/g, ' ');
  return text ? text.slice(0, 120) : undefined;
}

function locatorFor(el: Element): LocatorBundle {
  const e = el as HTMLElement;
  const dataAttrs: Record<string, string> = {};
  for (const a of [...e.attributes]) if (a.name.startsWith('data-') && Object.keys(dataAttrs).length < 3) dataAttrs[a.name] = a.value;
  const ownText = (e.innerText ?? e.textContent ?? '').trim().replace(/\s+/g, ' ');
  return buildLocatorBundle({
    tag: e.tagName, id: e.id || undefined, dataAttrs, role: e.getAttribute('role') ?? undefined,
    ariaLabel: e.getAttribute('aria-label') ?? undefined, accessibleName: accessibleName(e),
    text: ownText.length <= 60 ? ownText : undefined, cssPath: shortCssPath(e), landmarkPath: landmarkPath(e),
  }, (sel, kind) => {
    if (kind === 'text') {
      const [base, txt] = sel.split(' >> text=');
      const want = JSON.parse(txt);
      return [...document.querySelectorAll(base)].filter(n => (n as HTMLElement).innerText?.trim().replace(/\s+/g, ' ') === want).length;
    }
    return document.querySelectorAll(sel).length;
  });
}

const fieldInfo = (el: HTMLElement): FieldInfo => ({
  type: (el as HTMLInputElement).type, name: el.getAttribute('name') ?? undefined, id: el.id || undefined,
  autocomplete: el.getAttribute('autocomplete') ?? undefined, ariaLabel: el.getAttribute('aria-label') ?? undefined,
  placeholder: el.getAttribute('placeholder') ?? undefined,
});
const valueOf = (el: HTMLElement) => (el.isContentEditable ? el.innerText : (el as HTMLInputElement).value) ?? '';

function describeNode(n: Node): string {
  const e = n as Element;
  if (n.nodeType !== 1) return '#text';
  let s = e.tagName.toLowerCase();
  if (e.id) s += '#' + e.id;
  const cls = [...e.classList].slice(0, 2);
  if (cls.length) s += '.' + cls.join('.');
  const role = e.getAttribute('role'); if (role) s += `[role=${role}]`;
  return s;
}

const LIVE = '[role="status"], [role="alert"], [aria-live]:not([aria-live="off"]), output';
/** Toast heuristic: a small fixed/sticky element that just became visible (many apps use no aria-live). */
function liveTextOf(el: Element | null): string | undefined {
  if (!el || inOwnUi(el)) return undefined;
  const live = el.closest(LIVE);
  const host = live ?? el;
  if (!live) {
    const cs = getComputedStyle(host);
    if (cs.position !== 'fixed' && cs.position !== 'sticky') return undefined;
  }
  if (!isVisible(host)) return undefined;
  const t = ((host as HTMLElement).innerText ?? host.textContent ?? '').trim().replace(/\s+/g, ' ');
  return t && t.length <= 120 ? t : undefined;
}

export interface Recorder { setCapture(on: boolean): void; flush(): Promise<void>; readonly capturing: boolean }

export function startStepRecorder(): Recorder {
  let capture = false;
  let n = 0;
  let pendingInput: { el: HTMLElement; initial: string } | null = null;
  let inputIdle: ReturnType<typeof setTimeout> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastUrl = location.href;
  const titleAtOpen = new Map<string, string>();
  const sends: Promise<unknown>[] = [];

  const toDraft = (s: ClosedStep<Action>): StepDraft => ({
    id: s.id, origin: location.origin, url: location.href,
    action: s.action,
    effects: { ...s.effects, titleChange: document.title !== titleAtOpen.get(s.id) ? document.title : undefined },
    settled: s.settled, tStart: s.tStart, tEnd: s.tEnd,
    settle: { reason: s.reason, mutations: s.mutations, lastActivityMs: s.lastActivityMs },
    title: document.title,
  });

  const machine = new SettleMachine<Action>({
    onClose: (s) => { titleAtOpen.delete(s.id); const p = send({ type: 'WWA_STEP', step: toDraft(s) }); sends.push(p); void p.finally(() => sends.splice(sends.indexOf(p), 1)); },
    onLate: (stepId, late: StepLateEffects) => { void send({ type: 'WWA_STEP_LATE', stepId, late }); },
  });

  const schedule = () => {
    clearTimeout(timer);
    const d = machine.nextDeadline();
    if (d === undefined) return;
    timer = setTimeout(() => { machine.tick(Date.now()); schedule(); }, Math.max(0, d - Date.now()) + 5);
  };

  const open = (action: Action, opts: { held?: boolean } = {}) => {
    commitInput('interrupt');
    const id = `st_${Date.now().toString(36)}_${++n}`;
    titleAtOpen.set(id, document.title);
    machine.action(id, action, Date.now(), opts);
    schedule();
  };

  function commitInput(_why: string) {
    clearTimeout(inputIdle);
    const p = pendingInput;
    if (!p) return;
    pendingInput = null;
    const v = valueOf(p.el);
    if (machine.openAction?.kind === 'input-commit' && v !== p.initial) {
      machine.commit(Date.now(), { ...machine.openAction, valuePreview: redactTypedValue(v, fieldInfo(p.el)), valueHash: hashValue(v) || undefined });
      schedule();
    } else if (machine.openAction?.kind === 'input-commit') {
      machine.commit(Date.now());
      schedule();
    }
  }

  const actionFor = (kind: StepActionKind, el: Element, extra: Partial<Action> = {}): Action => {
    const target = locatorFor(el);
    return { kind, target, accessibleName: target.accessibleName, role: target.role, landmarkPath: target.landmarkPath, ...extra };
  };

  const eventTarget = (ev: Event): Element | null => {
    const path = ev.composedPath?.() ?? [];
    if (path.some(n => n instanceof Element && n.id?.startsWith('wwa-'))) return null; // our pill / generated widgets
    return (path[0] instanceof Element ? path[0] : ev.target) as Element | null;
  };

  // ---------------------------------------------------------------- meaningful events
  document.addEventListener('click', (ev) => {
    if (!capture || !ev.isTrusted) return;
    const raw = eventTarget(ev);
    if (!raw) return;
    const el = raw.closest(INTERACTIVE) ?? raw;
    if (isEditable(el) && el === pendingInput?.el) return; // clicking inside the field being typed in
    open(actionFor('click', el));
  }, true);

  document.addEventListener('input', (ev) => {
    if (!capture || !ev.isTrusted) return;
    const raw = eventTarget(ev);
    const el = (raw?.closest?.('[contenteditable="true"]') as HTMLElement | null) ?? (raw as HTMLElement | null);
    if (!el || !isEditable(el) || el.tagName === 'SELECT') return;
    if (pendingInput?.el !== el) {
      const initial = ''; // value before the first keystroke is unknown post-hoc; treat any non-empty value as a change
      open(actionFor('input-commit', el), { held: true });
      pendingInput = { el, initial };
    }
    // Some apps never blur (Gmail composer): commit after 1.5 s of typing inactivity.
    clearTimeout(inputIdle);
    inputIdle = setTimeout(() => commitInput('idle'), 1500);
  }, true);

  document.addEventListener('change', (ev) => {
    if (!capture || !ev.isTrusted) return;
    const el = eventTarget(ev) as HTMLElement | null;
    if (!el) return;
    if (el.tagName === 'SELECT') {
      const s = el as HTMLSelectElement;
      open(actionFor('select', el, { valuePreview: redactTypedValue(s.selectedOptions[0]?.textContent ?? s.value, fieldInfo(el)) }));
      return;
    }
    if (pendingInput?.el === el) commitInput('change');
  }, true);

  document.addEventListener('focusout', (ev) => {
    if (!capture) return;
    if (pendingInput && (ev.target === pendingInput.el || pendingInput.el.contains(ev.target as Node))) commitInput('blur');
  }, true);

  document.addEventListener('submit', (ev) => {
    if (!capture || !ev.isTrusted) return;
    const el = eventTarget(ev);
    if (el) open(actionFor('submit', el));
  }, true);

  document.addEventListener('keydown', (ev) => {
    if (!capture || !ev.isTrusted) return;
    const k = ev as KeyboardEvent;
    const t = eventTarget(ev);
    if (!t || isEditable(t) || (t as HTMLElement).isContentEditable) return;
    if (k.ctrlKey || k.metaKey || k.altKey) return;
    if (k.key.length !== 1 && k.key !== 'Escape' && k.key !== 'Delete') return; // single-key shortcuts only (Gmail "r")
    open({ kind: 'key-shortcut', key: k.key, accessibleName: accessibleName(t), target: t === document.body ? undefined : locatorFor(t) });
  }, true);

  // E9: copy/paste text is readable from the isolated world (selection + clipboardData); only hashes + redacted previews leave.
  const clip = (kind: 'copy' | 'paste') => (ev: Event) => {
    if (!capture || !ev.isTrusted) return;
    const ce = ev as ClipboardEvent;
    const text = kind === 'copy' ? (getSelection()?.toString() ?? '') : (ce.clipboardData?.getData('text/plain') ?? '');
    const t = eventTarget(ev) ?? document.body;
    const field = isEditable(t) ? fieldInfo(t as HTMLElement) : {};
    open({ ...actionFor(kind, t), valuePreview: redactTypedValue(text, field, 80), valueHash: hashValue(text) || undefined });
  };
  document.addEventListener('copy', clip('copy'), true);
  document.addEventListener('cut', clip('copy'), true);
  document.addEventListener('paste', clip('paste'), true);

  document.addEventListener('drop', (ev) => {
    if (!capture || !ev.isTrusted) return;
    const t = eventTarget(ev);
    const files = [...((ev as DragEvent).dataTransfer?.files ?? [])].map(f => f.name).join(', ');
    if (t) open(actionFor('drag-drop', t, { valuePreview: files.slice(0, 120) || undefined }));
  }, true);

  // ---------------------------------------------------------------- effects
  const mo = new MutationObserver((records) => {
    if (!capture) return;
    const now = Date.now();
    let significant = false;
    const added: RegionLite[] = [];
    const removed: string[] = [];
    const live = new Set<string>();
    const addedRoots = new Set<Element>();
    for (const r of records) {
      const own = inOwnUi(r.target);
      const tgt = r.target.nodeType === 1 ? (r.target as Element) : r.target.parentElement;
      const addedEls = [...r.addedNodes].filter(n => n.nodeType === 1 && !inOwnUi(n)) as Element[];
      const removedEls = [...r.removedNodes].filter(n => n.nodeType === 1 && !(n as Element).id?.startsWith('wwa-')) as Element[];
      const textNodes = r.type === 'childList' && !addedEls.length && !removedEls.length;
      const sig = isSignificantMutation({
        type: r.type, inOwnUi: own, targetVisible: isVisible(tgt),
        addedElements: addedEls.length, removedElements: removedEls.length,
        textBefore: r.type === 'characterData' ? r.oldValue ?? '' : textNodes ? [...r.removedNodes].map(x => x.textContent).join('') : undefined,
        textAfter: r.type === 'characterData' ? r.target.textContent ?? '' : textNodes ? [...r.addedNodes].map(x => x.textContent).join('') : undefined,
        attributeName: r.attributeName ?? undefined,
      });
      if (!sig) continue;
      significant = true;
      for (const el of addedEls) if (isVisible(el) || el.children.length) addedRoots.add(el);
      for (const el of removedEls) removed.push(describeNode(el));
      const lt = liveTextOf(tgt);
      if (lt) live.add(lt);
    }
    if (!significant) return;
    // keep only top-most added roots
    for (const el of addedRoots) {
      let p = el.parentElement, nested = false;
      while (p) { if (addedRoots.has(p)) { nested = true; break; } p = p.parentElement; }
      if (nested) continue;
      const lt = liveTextOf(el);
      if (lt) live.add(lt);
      if (added.length < 4) added.push({ root: shortCssPath(el), skeleton: skeletonOf(el, 1200, 4) });
    }
    machine.mutation(now, { added, removed, liveText: [...live] });
    if (location.href !== lastUrl) { lastUrl = location.href; machine.url(now, lastUrl); }
    schedule();
  });

  netActivity.subscribe((e) => {
    if (!capture) return;
    if (e.kind === 'start') machine.netStart(e.id, Date.now());
    else {
      let route = e.url;
      try { route = new URL(e.url, location.href).pathname; } catch { /* keep */ }
      machine.netEnd(e.id, Date.now(), { opId: e.id, method: e.method, routeTemplate: route, status: e.status });
    }
    schedule();
  });

  // SPA navigations without a user action → navigate Step; with an open Step → urlChange effect.
  const checkUrl = () => {
    if (!capture || location.href === lastUrl) return;
    lastUrl = location.href;
    if (machine.isOpen) { machine.url(Date.now(), lastUrl); schedule(); }
    else open({ kind: 'navigate', accessibleName: document.title });
  };
  window.addEventListener('popstate', checkUrl);
  window.addEventListener('hashchange', checkUrl);
  setInterval(checkUrl, 500);

  return {
    get capturing() { return capture; },
    setCapture(on: boolean) {
      if (on === capture) return;
      capture = on;
      if (on) {
        lastUrl = location.href;
        mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true, characterDataOldValue: true });
      } else {
        commitInput('stop'); machine.flush(Date.now()); mo.disconnect(); clearTimeout(timer);
      }
    },
    async flush() {
      commitInput('flush');
      machine.flush(Date.now());
      schedule();
      await Promise.all([...sends]);
    },
  };
}
