// PoC driver v2: enable toggles via chrome://extensions UI, relaunch, verify.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.join(DIR, 'extension');
const EXT_ID = fs.readFileSync(path.join(DIR, 'extid.txt'), 'utf8').trim();
const PROFILE = path.join(DIR, 'profile3');
const PORT = 8123;
const HEADLESS = process.env.HEADED !== '1';

const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'text/html');
  res.end(fs.readFileSync(path.join(DIR, 'testpage', 'index.html')));
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));

const launch = () => chromium.launchPersistentContext(PROFILE, {
  channel: 'chromium', headless: HEADLESS,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});

const fail = (m) => { console.error('FAIL:', m); process.exitCode = 1; };
const ok = (m) => console.log('PASS:', m);

async function enableToggles() {
  const context = await launch();
  try {
    const page = await context.newPage();
    await page.goto(`chrome://extensions/?id=${EXT_ID}`);
    await page.waitForTimeout(1500);
    const res = await page.evaluate(() => {
      const seen = new Set(); const clicks = [];
      const click = (el) => { const btn = el.shadowRoot?.querySelector('#button') || el; (el.shadowRoot ? btn : el).click(); };
      const walk = (root) => {
        for (const el of root.querySelectorAll('*')) {
          if (el.shadowRoot && !seen.has(el.shadowRoot)) { seen.add(el.shadowRoot); walk(el.shadowRoot); }
          if (el.tagName === 'CR-TOGGLE' && !el.hasAttribute('checked')) {
            let p = el, txt = '';
            for (let i = 0; i < 6 && p; i++) { p = p.parentElement || p.getRootNode()?.host; if (p?.textContent?.trim().length > 15) { txt = p.textContent.trim(); break; } }
            if (el.id === 'devMode' || /Allow User Scripts/i.test(txt)) {
              const btn = el.shadowRoot?.querySelector('cr-toggle, #button, .mdc-switch, input') || el;
              btn.click(); clicks.push(el.id === 'devMode' ? 'devMode' : 'userScripts:' + txt.slice(0, 40));
            }
          }
        }
      };
      walk(document);
      return clicks;
    });
    console.log('clicked:', JSON.stringify(res));
    await page.waitForTimeout(800);
  } finally { await context.close(); }
}

fs.rmSync(PROFILE, { recursive: true, force: true });
await enableToggles();

const context = await launch();
try {
  let sw = context.serviceWorkers()[0];
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15000 });
  const status = await sw.evaluate(() => globalThis.__pocStatus());
  console.log('status:', JSON.stringify(status));
  if (!status.hasUserScripts) { fail('chrome.userScripts still undefined after toggle'); }
  else {
    ok('chrome.userScripts available (execute=' + status.hasExecute + ')');
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${PORT}/index.html`);
    await page.waitForLoadState('domcontentloaded');

    const generated = `(async () => {
      const btn = document.createElement('button');
      btn.id = 'poc-btn';
      btn.textContent = 'POC WIDGET';
      btn.style.cssText = 'position:fixed;top:10px;right:10px;z-index:2147483647;padding:8px;background:#4a3aff;color:#fff;border:0;';
      btn.addEventListener('click', async () => {
        const r = await chrome.runtime.sendMessage({ type: 'PING', payload: 'click' });
        btn.textContent = 'PONG:' + JSON.stringify(r);
      });
      (document.querySelector('#toolbar') || document.body).appendChild(btn);
      const pong = await chrome.runtime.sendMessage({ type: 'PING', payload: 'init' });
      btn.dataset.pong = JSON.stringify(pong);
      return { inserted: !!document.getElementById('poc-btn'), pong, seesNative: typeof window.__native };
    })()`;

    const results = await sw.evaluate((c) => globalThis.__pocExec(c), generated);
    console.log('execute results:', JSON.stringify(results));
    const r0 = results?.[0];
    if (r0?.error) fail('injection error: ' + r0.error);
    if (r0?.result?.inserted) ok('generated code executed & inserted into native #toolbar');
    if (r0?.result?.pong?.pong) ok('userScript->SW messaging round-trip: ' + JSON.stringify(r0.result.pong));
    console.log('world isolation (seesNative should be "undefined"):', JSON.stringify(r0?.result?.seesNative));

    await page.waitForSelector('#poc-btn', { timeout: 5000 });
    ok('button present in page DOM');
    await page.click('#poc-btn');
    await page.waitForFunction(() => document.getElementById('poc-btn')?.textContent?.startsWith('PONG:'), { timeout: 5000 });
    ok('post-exec click messaging works');

    const reg = await sw.evaluate(() => chrome.userScripts.register([{ id: 'persist1', matches: ['*://127.0.0.1/*'], js: [{ code: `document.title='POC-PERSISTED';` }], runAt: 'document_idle' }]).then(() => 'registered').catch(e => 'ERR:' + e));
    console.log('register:', reg);
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    const title = await page.title();
    title === 'POC-PERSISTED' ? ok('registered script ran on reload') : fail('no persist, title=' + title);
  }
} catch (e) { fail('exception: ' + (e?.stack || e)); }
finally { await context.close().catch(() => {}); server.close(); }
console.log(process.exitCode ? '=== POC FAILED ===' : '=== POC PASSED ===');
