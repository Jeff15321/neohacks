/**
 * Real-Gmail live test — nearly push-button.
 *  1. Launches a persistent Chromium profile WITH the extension (session
 *     persists between runs — you only log in once, ever).
 *  2. Opens Gmail; waits for you to sign in if needed (polls for the inbox).
 *  3. Opens the side-panel UI, submits the unread-drafter request, approves.
 *  4. Clicks the widget button and watches Gmail Drafts count.
 * Usage:  cd tests/tools && npx tsx gmail-live.mjs
 *         (backend must be running: LLM_PROVIDER=anthropic npm run dev:backend)
 */
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(DIR, '../../apps/extension/dist');
const EXT_ID = 'jbdmmaojlbiclmjbafphlchlnppplpen';
const PROFILE = path.join(DIR, '.gmail-profile');       // persists your login
const REQUEST = 'Add a button that reads my two most recent unread emails and writes a friendly AI-generated reply draft for each.';

if (!fs.existsSync(path.join(EXT, 'manifest.json'))) { console.error('build the extension first: npm run build:extension'); process.exit(1); }
try { await fetch('http://127.0.0.1:8787/health'); } catch { console.error('backend down — npm run dev:backend'); process.exit(1); }

const context = await chromium.launchPersistentContext(PROFILE, {
  channel: 'chromium',
  headless: false,                                     // you may need to interact (login)
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});

// enable userScripts toggle if needed (only first run)
let sw = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 20000 });
const hasUS = await sw.evaluate(() => typeof chrome.userScripts !== 'undefined');
if (!hasUS) {
  console.log('enabling userScripts toggle via chrome://extensions ...');
  const p = await context.newPage();
  await p.goto(`chrome://extensions/?id=${EXT_ID}`);
  await p.waitForTimeout(1200);
  await p.evaluate(`(() => { const seen=new Set(); const walk=(r)=>{ for(const el of r.querySelectorAll('*')){ if(el.shadowRoot&&!seen.has(el.shadowRoot)){seen.add(el.shadowRoot);walk(el.shadowRoot);} if(el.tagName==='CR-TOGGLE'&&!el.hasAttribute('checked')){ let p=el,t=''; for(let i=0;i<6&&p;i++){p=p.parentElement||(p.getRootNode()&&p.getRootNode().host)||null; if(p&&p.textContent&&p.textContent.trim().length>15){t=p.textContent.trim();break;}} if(/Allow User Scripts/i.test(t)){(el.shadowRoot&&el.shadowRoot.querySelector('#button,input')||el).click();} } } }; walk(document); })()`);
  await p.close();
  await context.close();
  console.log('relaunching (toggle needs a context restart)…');
  process.exit(0); // re-run the script — profile now has the toggle on
}

const page = await context.newPage();
await page.goto('https://mail.google.com/mail/u/0/#inbox');

console.log('waiting for Gmail inbox (log in manually if prompted)…');
// Gmail inbox detection: the thread grid exists under [role=main]
await page.waitForSelector('div[role="main"]', { timeout: 120_000 });
for (let i = 0; i < 120; i++) {
  if (await page.locator('tr.zA, div[role="main"] table').count() > 0) break;
  if (page.url().includes('accounts.google.com')) await page.waitForTimeout(2000); else await page.waitForTimeout(1000);
}
const unread = await page.locator('tr.zA.zE').count();
console.log(`inbox detected — ${unread} unread row(s) visible`);

const panel = await context.newPage();
await panel.goto(`chrome-extension://${EXT_ID}/sidepanel.html`);
await panel.waitForSelector('#req');
await panel.fill('#req', REQUEST);
console.log('generating widget (real LLM)…');
await panel.click('#gen-btn');
await panel.waitForSelector('[data-testid="approval-card"] h3', { timeout: 600_000 });
console.log('CARD:', (await panel.locator('[data-testid="approval-card"]').first().innerText()).split('\n').slice(0, 4).join(' | '));

console.log('approving & injecting…');
await panel.click('[data-testid="approve"]');
await page.waitForSelector('div[id^="wwa-"]', { timeout: 30_000 }).catch(() => console.log('!! widget host not found in DOM'));

const widgetBtns = await page.locator('div[id^="wwa-"] >> css=button').count();
console.log(`widget rendered ${widgetBtns} button(s) — clicking to start workflow`);
await page.locator('div[id^="wwa-"] >> css=button').first().click();

// watch Drafts folder count + panel log
const t0 = Date.now();
let lastLog = '';
while (Date.now() - t0 < 300_000) {
  const log = await panel.evaluate(() => document.body.innerText);
  if (log !== lastLog) { lastLog = log; const tail = log.split('\n').slice(-2).join(' | '); console.log('…', tail.slice(0, 200)); }
  if (/completed|failed/.test(log)) break;
  await page.waitForTimeout(2000);
}
console.log('=== panel tail ===');
console.log(lastLog.split('\n').slice(-8).join('\n'));
console.log('>>> Now check Gmail Drafts folder manually. Leaving browser open 5 min for inspection…');
await page.waitForTimeout(300_000);
await context.close();
