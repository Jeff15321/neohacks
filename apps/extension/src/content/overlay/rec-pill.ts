/**
 * In-page recording indicator (decision A): pulsing "REC" pill in an extension-owned Shadow DOM (vanilla TS,
 * no React). Click = stop recording. The host id starts with `wwa-` so the Step recorder and skeletons ignore it.
 */
const HOST_ID = 'wwa-rec-pill';

const CSS = `
:host { all: initial; }
.pill { position: fixed; top: 12px; right: 12px; z-index: 2147483647; display: flex; align-items: center; gap: 8px;
  font: 600 12px/1 system-ui, -apple-system, Segoe UI, sans-serif; color: #fff; background: #b91c1c;
  border: 0; border-radius: 999px; padding: 7px 12px 7px 10px; cursor: pointer; box-shadow: 0 2px 10px rgba(0,0,0,.25); }
.pill:hover { background: #991b1b; }
.dot { width: 9px; height: 9px; border-radius: 50%; background: #fff; animation: pulse 1.2s ease-in-out infinite; }
.n { font-weight: 400; opacity: .85; }
@keyframes pulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: .35; transform: scale(.8); } }
`;

export function setRecPill(on: boolean, opts: { stepCount?: number; onStop: () => void }) {
  let host = document.getElementById(HOST_ID);
  if (!on) { host?.remove(); return; }
  if (!host) {
    host = document.createElement('div');
    host.id = HOST_ID;
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${CSS}</style><button class="pill" title="Recording — click to stop (Alt+Shift+R)"><span class="dot"></span>REC <span class="n"></span> · Stop</button>`;
    root.querySelector('button')!.addEventListener('click', (e) => { e.stopPropagation(); opts.onStop(); });
    (document.body ?? document.documentElement).appendChild(host);
  }
  const n = host.shadowRoot?.querySelector('.n');
  if (n) n.textContent = opts.stepCount !== undefined ? `${opts.stepCount} step${opts.stepCount === 1 ? '' : 's'}` : '';
}
