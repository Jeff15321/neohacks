import { chromium, type BrowserContext, type Worker } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
export const EXT_PATH = path.resolve(DIR, '../../apps/extension/dist');
export const FIXTURE_URL = 'http://127.0.0.1:8787/fixture/index.html';
export const EXT_ID = 'jbdmmaojlbiclmjbafphlchlnppplpen'; // from manifest key
const PROFILE = path.join(DIR, '.pw-profile');
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
  })()`);
  console.log('[e2e] enabled toggles:', clicked.join(','));
  await page.close();
}

/**
 * Launch a browser with the extension loaded and chrome.userScripts enabled.
 * Verified empirically on Chromium 158 (see docs/feasibility.md).
 */
export async function launchWithExtension(opts: LaunchOpts = {}): Promise<{ context: BrowserContext; sw: Worker }> {
  extraOpts = opts;
  fs.rmSync(PROFILE, { recursive: true, force: true });
  let context = await launch();
  let sw = await getSW(context);
  const has = await sw.evaluate(() => typeof (chrome as any).userScripts !== 'undefined').catch(() => false);
  if (!has) {
    await enableToggles(context);
    await context.close();
    context = await launch();           // SW rebinds chrome.userScripts at context start
    sw = await getSW(context);
    const has2 = await sw.evaluate(() => typeof (chrome as any).userScripts !== 'undefined');
    if (!has2) throw new Error('chrome.userScripts still unavailable after toggles');
  }
  return { context, sw };
}
