import { chromium, type BrowserContext, type Page, type Worker } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
/** Backend/fixture port. Parallel worktrees each use their own E2E_PORT (default 8787). */
export const PORT = Number(process.env.E2E_PORT ?? 8787);
export const BASE = `http://127.0.0.1:${PORT}`;
export const EXT_PATH = path.resolve(DIR, '../../apps/extension/dist');
export const FIXTURE_URL = `${BASE}/fixture/index.html`;
export const G2_URL = `${BASE}/fixture-g2/index.html`;
export const YT_URL = `${BASE}/fixture-yt/index.html`;
export const NET_URL = `${BASE}/fixture-net/index.html`;
export const EXT_ID = 'jbdmmaojlbiclmjbafphlchlnppplpen'; // from manifest key
export const TOKEN = 'dev-token-change-me';
/** PW_PROFILE lets a tools/ script run next to another browser session (default: the shared E2E profile). */
const PROFILE = process.env.PW_PROFILE ?? path.join(DIR, '.pw-profile');
const HEADED = process.env.HEADED === '1';

interface LaunchOpts { recordVideoDir?: string; headed?: boolean; }
let extraOpts: LaunchOpts = {};

async function launch(): Promise<BrowserContext> {
  return chromium.launchPersistentContext(PROFILE, {
    channel: 'chromium',
    headless: !(extraOpts.headed ?? HEADED),
    ...(extraOpts.recordVideoDir ? { recordVideo: { dir: extraOpts.recordVideoDir, size: { width: 1400, height: 900 } } } : {}),
    viewport: extraOpts.recordVideoDir ? { width: 1400, height: 900 } : undefined,
    args: [`--disable-extensions-except=${EXT_PATH}`, `--load-extension=${EXT_PATH}`],
  });
}

async function getSW(context: BrowserContext): Promise<Worker> {
  let sw = context.serviceWorkers()[0];
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 20_000 });
  return sw;
}

/** Flip dev-mode + per-extension "Allow User Scripts" toggles via chrome://extensions UI. */
async function enableToggles(context: BrowserContext) {
  const page = await context.newPage();
  await page.goto(`chrome://extensions/?id=${EXT_ID}`);
  await page.waitForTimeout(1200);
  // NOTE: string form — a function literal would be wrapped by esbuild's
  // keepNames transform (__name) which does not exist in the page context.
  const clicked = await page.evaluate(`(() => {
    const seen = new Set(); const clicks = [];
    const walk = (root) => {
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot && !seen.has(el.shadowRoot)) { seen.add(el.shadowRoot); walk(el.shadowRoot); }
        if (el.tagName === 'CR-TOGGLE' && !el.hasAttribute('checked')) {
          let p = el; let txt = '';
          for (let i = 0; i < 6 && p; i++) {
            p = p.parentElement || (p.getRootNode() && p.getRootNode().host) || null;
            if (p && p.textContent && p.textContent.trim().length > 15) { txt = p.textContent.trim(); break; }
          }
          if (el.id === 'devMode' || /Allow User Scripts/i.test(txt)) {
            const btn = (el.shadowRoot && el.shadowRoot.querySelector('#button, input')) || el;
            btn.click();
            clicks.push(el.id === 'devMode' ? 'devMode' : 'userScripts');
          }
        }
      }
    };
    walk(document);
    return clicks;
  })()`) as string[];
  console.log('[e2e] enabled toggles:', clicked.join(','));
  await page.close();
}

/** Launch a browser with the extension loaded and chrome.userScripts enabled. */
export async function launchWithExtension(opts: LaunchOpts = {}): Promise<{ context: BrowserContext; sw: Worker }> {
  extraOpts = opts;
  fs.rmSync(PROFILE, { recursive: true, force: true });
  let context = await launch();
  let sw = await getSW(context);
  const has = await sw.evaluate('typeof chrome.userScripts !== "undefined"').catch(() => false);
  if (!has) {
    await enableToggles(context);
    await context.close();
    context = await launch();           // SW rebinds chrome.userScripts at context start
    sw = await getSW(context);
    const has2 = await sw.evaluate('typeof chrome.userScripts !== "undefined"');
    if (!has2) throw new Error('chrome.userScripts still unavailable after toggles');
  }
  return { context, sw };
}

/** Open the side-panel UI as an extension page (same UI as the real side panel). */
export async function openPanel(context: BrowserContext): Promise<Page> {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${EXT_ID}/sidepanel.html`);
  await panel.waitForSelector('#req');
  return panel;
}

/** Create tab: request → Generate → approval card. Returns the card's title text. */
export async function generate(panel: Page, request: string, timeout = 30_000): Promise<string> {
  await panel.click('[data-testid="tab-create"]');
  await panel.fill('#req', request);
  await panel.click('#gen-btn');
  const card = panel.locator('[data-testid="approval-card"]').first();
  await card.locator('h3').waitFor({ timeout });
  return card.locator('h3').innerText();
}

/** Approve the first pending widget (installs + runs it; panel switches to Widgets). */
export async function approveFirst(panel: Page) {
  await panel.locator('[data-testid="approval-card"] [data-testid="approve"]').first().click();
  await panel.locator('[data-testid="widget-card"]').first().waitFor({ timeout: 10_000 });
}

/** Wait until an installed widget reports `status` in the panel. */
export async function waitForWidgetStatus(panel: Page, status: string, timeout = 30_000) {
  await panel.locator(`[data-testid="widget-card"] [data-testid="widget-status"]:text-is("${status}")`).first().waitFor({ timeout });
}

/** SW bus log entries (via the debugging handle in background/main.ts). */
export async function busLog(sw: Worker): Promise<Array<{ type: string; channel: string; ok: boolean; traceId?: string; error?: string }>> {
  return sw.evaluate('globalThis.__wwaBus.log.list()') as Promise<Array<{ type: string; channel: string; ok: boolean; traceId?: string; error?: string }>>;
}
