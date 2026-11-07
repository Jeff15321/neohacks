// Live-LLM run of the network-observation pipeline against the NetMail fixture.
// Usage: TARGET_URL=http://127.0.0.1:8787/fixture-net/index.html npx tsx net-live.mjs
// (backend must be running with LLM_PROVIDER=anthropic on :8787)
import { launchWithExtension, EXT_ID } from '../e2e/helpers.ts';

const { context } = await launchWithExtension();
const page = await context.newPage();
const TARGET = process.env.TARGET_URL || 'http://127.0.0.1:8787/fixture-net/index.html';

// reset fixture state, then perform the user action so the POST is captured
await fetch('http://127.0.0.1:8787/fixture-api/__reset', { method: 'POST' });
await page.goto(TARGET);
await page.waitForSelector('tr.zA');
await page.click('#compose-btn');
await page.fill('#cm-to', 'user@example.com');
await page.fill('#cm-subject', 'Manual draft');
await page.fill('#cm-body', 'typed by the user through the UI');
await page.click('#cm-save');
await page.waitForTimeout(800);

const panel = await context.newPage();
await panel.goto(`chrome-extension://${EXT_ID}/sidepanel.html`);
await panel.waitForSelector('#req');
await panel.click('#net-toggle');
await page.waitForTimeout(500);
console.log('NET OPS:', (await panel.locator('.card.net').innerText()).replace(/\n/g, ' | ').slice(0, 600));

await panel.fill('#req', process.env.REQUEST || 'Add a button that creates an email draft to live-test@example.com with subject "Live API test" using the captured save-draft network call, then verify it exists.');
await panel.click('#gen-btn');
await panel.waitForSelector('.card h3', { timeout: 120000 });
const sw = context.serviceWorkers()[0];
const code = await sw.evaluate(async () => (await chrome.storage.local.get('wwa_widgets')).wwa_widgets?.[0]?.code);
console.log('=== GENERATED CODE ===\n' + code + '\n=== END ===');
await panel.click('button.primary:has-text("Approve & Run")');
await page.waitForSelector('div[id^="wwa-"]', { timeout: 20000 });
await page.waitForTimeout(500);
await page.locator('div[id^="wwa-"] >> css=button').first().click();
await page.waitForTimeout(12000);
const drafts = await (await fetch('http://127.0.0.1:8787/fixture-api/drafts')).json();
console.log('DRAFTS:', JSON.stringify(drafts.drafts?.map(d => ({ to: d.to, subject: d.subject }))));
console.log('PANEL:', (await panel.evaluate(() => document.body.innerText)).replace(/\n/g, ' | ').slice(0, 1500));
await context.close();
