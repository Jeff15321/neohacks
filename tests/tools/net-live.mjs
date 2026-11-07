// Live-LLM run of the network-observation pipeline against the NetMail fixture.
// Usage: [E2E_PORT=8787] npx tsx net-live.mjs   (TARGET_URL overrides the fixture URL)
// (backend must be running with LLM_PROVIDER=anthropic on E2E_PORT, extension built with BACKEND_URL for that port)
import { launchWithExtension, openPanel, generate, approveFirst, BASE } from '../e2e/helpers.ts';

const { context } = await launchWithExtension();
const page = await context.newPage();
const TARGET = process.env.TARGET_URL || `${BASE}/fixture-net/index.html`;

// reset fixture state, then perform the user action so the POST is captured
await fetch(`${BASE}/fixture-api/__reset`, { method: 'POST' });
await page.goto(TARGET);
await page.waitForSelector('tr.zA');
await page.click('#compose-btn');
await page.fill('#cm-to', 'user@example.com');
await page.fill('#cm-subject', 'Manual draft');
await page.fill('#cm-body', 'typed by the user through the UI');
await page.click('#cm-save');
await page.waitForTimeout(800);

const panel = await openPanel(context);
await panel.click('[data-testid="tab-inspector"]'); await panel.click('[data-testid="net-refresh"]');
await page.waitForTimeout(500);
console.log('NET OPS:', (await panel.locator('[data-testid="net-ops"]').innerText()).replace(/\n/g, ' | ').slice(0, 600));

const t0 = Date.now();
const title = await generate(panel, process.env.REQUEST || 'Add a button that creates an email draft to live-test@example.com with subject "Live API test" using the captured save-draft network call, then verify it exists.', 300000);
console.log('GENERATED:', title, `(${Math.round((Date.now() - t0) / 1000)} s)`);
const code = await panel.evaluate(async () => { const w = (await chrome.storage.local.get('wwa_widgets')).wwa_widgets; return (Array.isArray(w) ? w[0] : Object.values(w ?? {})[0])?.code; });
console.log('=== GENERATED CODE ===\n' + code + '\n=== END ===');
await approveFirst(panel);
await page.waitForSelector('div[id^="wwa-"]', { timeout: 20000 });
await page.waitForTimeout(500);
await page.locator('div[id^="wwa-"] >> css=button').first().click();
await page.waitForTimeout(Number(process.env.RUN_WAIT_MS || 15000));
const drafts = await (await fetch(`${BASE}/fixture-api/drafts`)).json();
console.log('DRAFTS:', JSON.stringify(drafts.drafts?.map(d => ({ to: d.to, subject: d.subject }))));
console.log('CSRF REJECTED:', JSON.stringify(await (await fetch(`${BASE}/fixture-api/__csrf-stats`)).json()));
const opsReply = await panel.evaluate(() => chrome.runtime.sendMessage({ type: 'GET_NET_OPS' }));
console.log('TIERS:', JSON.stringify((opsReply.ops || []).filter(o => !o.replay).map(o => `${o.method} ${o.path} ${o.tier}`)));
console.log('PANEL:', (await panel.evaluate(() => document.body.innerText)).replace(/\n/g, ' | ').slice(0, 1500));
await context.close();
