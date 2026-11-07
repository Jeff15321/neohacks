import { launchWithExtension, FIXTURE_URL, EXT_ID } from './helpers.ts';
const { context, sw } = await launchWithExtension();
const page = await context.newPage();
await page.goto(FIXTURE_URL);
await page.waitForSelector('.msg-row');
const panel = await context.newPage();
await panel.goto(`chrome-extension://${EXT_ID}/sidepanel.html`);
await panel.waitForSelector('#req');
await panel.fill('#req', 'Add a button that reads my two most recent unread emails and writes a friendly AI-generated reply draft for each.');
await panel.click('#gen-btn');
await panel.waitForSelector('.card h3', { timeout: 120000 });
const card = await panel.locator('.card').first().innerText();
console.log('CARD:', card.split('\n').slice(0,4).join(' | '));
// dump code for inspection
const code = await sw.evaluate(async () => (await chrome.storage.local.get('wwa_widgets')).wwa_widgets?.[0]?.code);
console.log('=== GENERATED CODE ===\n' + code + '\n=== END ===');
await panel.click('button.primary:has-text("Approve & Run")');
await page.waitForSelector('div[id^="wwa-"]', { timeout: 20000 });
await page.waitForTimeout(500);
const btnCount = await page.locator('div[id^="wwa-"] >> css=button').count();
console.log('widget buttons found:', btnCount);
await page.locator('div[id^="wwa-"] >> css=button').first().click();
const t0 = Date.now();
while (Date.now() - t0 < 90000) {
  const d = await page.evaluate(() => ({ d: window.__drafts?.length, s: window.__sent?.length }));
  if (d.d >= 2) break;
  await page.waitForTimeout(1500);
}
console.log('drafts:', await page.evaluate(() => JSON.stringify(window.__drafts?.map(d => ({id: d.msgId, body: d.body.slice(0,80)})))));
console.log('sent:', await page.evaluate(() => JSON.stringify(window.__sent)));
console.log('PANEL:', (await panel.evaluate(() => document.body.innerText)).replace(/\n/g,' | ').slice(0, 1200));
await context.close();
