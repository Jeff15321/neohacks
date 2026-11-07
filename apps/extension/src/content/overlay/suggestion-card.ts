/**
 * In-page suggestion card (Phase D, doc §7): bottom-right, non-modal, extension-owned Shadow DOM (vanilla TS, no
 * React). Title, one-line why, Details (observed steps), Accept · Not now · Never for this. States: generating
 * (progress ring; Accept allowed → "Preparing…") → ready → failed (Retry). Accept opens the approval card in the
 * panel — the widget never runs from here. Host id starts with `wwa-` so the Step recorder ignores it.
 */
import type { Suggestion } from '@app/contracts';

const HOST_ID = 'wwa-suggestion-card';

const CSS = `
:host { all: initial; }
.card { position: fixed; right: 16px; bottom: 16px; z-index: 2147483646; width: 320px; box-sizing: border-box;
  font: 13px/1.4 system-ui, -apple-system, Segoe UI, sans-serif; color: #0f172a; background: #fff; border: 1px solid #e2e8f0;
  border-radius: 12px; padding: 12px 14px; box-shadow: 0 10px 30px rgba(15,23,42,.18); }
.top { display: flex; gap: 10px; align-items: flex-start; }
.ring { flex: none; width: 16px; height: 16px; margin-top: 2px; border-radius: 50%; border: 2px solid #c7d2fe; border-top-color: #4f46e5; animation: spin .9s linear infinite; }
.ring.ready { animation: none; border-color: #22c55e; background: #22c55e; }
.ring.failed { animation: none; border-color: #ef4444; background: #ef4444; }
.title { font-weight: 600; margin: 0 0 2px; }
.why { color: #475569; font-size: 12px; margin: 0; }
.state { color: #64748b; font-size: 11px; margin-top: 4px; }
details { margin-top: 8px; font-size: 12px; color: #334155; }
summary { cursor: pointer; color: #4f46e5; }
ol { margin: 4px 0 0; padding-left: 18px; }
.btns { display: flex; gap: 6px; margin-top: 10px; flex-wrap: wrap; }
button { font: 600 12px system-ui, sans-serif; border-radius: 8px; padding: 6px 10px; cursor: pointer; border: 1px solid #cbd5e1; background: #fff; color: #0f172a; }
button.primary { background: #4f46e5; border-color: #4f46e5; color: #fff; }
button:disabled { opacity: .6; cursor: default; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-color-scheme: dark) { .card { background: #0f172a; color: #e2e8f0; border-color: #334155; } .why, .state, details { color: #94a3b8; } button { background: #1e293b; color: #e2e8f0; border-color: #334155; } }
`;

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

type Act = 'accept' | 'not_now' | 'never' | 'retry';

export function renderSuggestionCard(s: Suggestion | null, onAction: (id: string, a: Act) => void) {
  let host = document.getElementById(HOST_ID);
  if (!s) { host?.remove(); return; }
  if (!host) {
    host = document.createElement('div');
    host.id = HOST_ID;
    host.attachShadow({ mode: 'open' });
    (document.body ?? document.documentElement).appendChild(host);
  }
  const root = host.shadowRoot!;
  host.dataset.state = s.status;
  host.dataset.suggestionId = s.id;
  const stateText = s.status === 'generating' ? (s.acceptPending ? 'Preparing… the approval card opens when ready' : 'Preparing the widget in the background…')
    : s.status === 'ready' ? 'Ready — review it before anything runs' : `Couldn't build it${s.error ? `: ${esc(s.error.slice(0, 120))}` : ''} — retry or open in panel`;
  root.innerHTML = `<style>${CSS}</style>
  <div class="card" role="dialog" aria-label="Widget suggestion">
    <div class="top"><span class="ring ${s.status}"></span><div>
      <p class="title" data-testid="sg-title">${esc(s.title)}</p>
      <p class="why" data-testid="sg-why">${esc(s.why)}</p>
      <div class="state" data-testid="sg-state">${stateText}</div>
    </div></div>
    ${s.details?.length ? `<details><summary>Details</summary><ol>${s.details.map(d => `<li>${esc(d)}</li>`).join('')}</ol></details>` : ''}
    <div class="btns">
      ${s.status === 'failed'
        ? '<button class="primary" data-a="retry">Retry</button>'
        : `<button class="primary" data-a="accept" ${s.acceptPending ? 'disabled' : ''}>${s.status === 'generating' ? (s.acceptPending ? 'Preparing…' : 'Accept') : 'Accept'}</button>`}
      <button data-a="not_now">Not now</button>
      <button data-a="never">Never for this</button>
    </div>
  </div>`;
  root.querySelectorAll<HTMLButtonElement>('button[data-a]').forEach(b => b.addEventListener('click', (e) => {
    e.stopPropagation();
    onAction(s.id, b.dataset.a as Act);
  }));
}

/** Content-script side: listen for WWA_SUGGESTION, relay button clicks, ask on load whether a card is pending. */
export function startSuggestionCard() {
  const act = (id: string, action: Act) => {
    void chrome.runtime.sendMessage({ type: 'WWA_SUGGESTION_ACTION', suggestionId: id, action }).then((r: { ok?: boolean; suggestion?: Suggestion } | undefined) => {
      if (r?.ok && r.suggestion) render(r.suggestion);
    }).catch(() => {});
  };
  const render = (s: Suggestion | null) => {
    const visible = s && !s.snoozed && (s.status === 'generating' || s.status === 'ready' || s.status === 'failed') ? s : null;
    renderSuggestionCard(visible, act);
  };
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'WWA_SUGGESTION') render(msg.suggestion ?? null);
    return undefined;
  });
  void chrome.runtime.sendMessage({ type: 'WWA_SUGGESTION_QUERY' }).then((r: { suggestion?: Suggestion | null } | undefined) => render(r?.suggestion ?? null)).catch(() => {});
}
