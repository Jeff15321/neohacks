import { launchWithExtension, FIXTURE_URL, EXT_ID } from '../e2e/helpers.ts';
const { context, sw } = await launchWithExtension();
const page = await context.newPage();
page.on('console', m => { const t = m.text(); if (!/404|favicon/.test(t)) console.log('[page]', t.slice(0,250)); });
await page.goto(FIXTURE_URL);
await page.waitForSelector('.msg-row');
const panel = await context.newPage();
await panel.goto(`chrome-extension://${EXT_ID}/sidepanel.html`);
await panel.waitForSelector('#req');
await panel.fill('#req', 'x');
await panel.click('#gen-btn');
await panel.waitForSelector('[data-testid="approval-card"] h3');
await panel.click('[data-testid="approve"]');
await page.waitForSelector('.gj-toolbar div[id^="wwa-"]', { timeout: 15000 });
await page.locator('.gj-toolbar div[id^="wwa-"] >> css=button').click();
for (let i = 0; i < 30; i++) {
  const d = await page.evaluate(() => ({ drafts: window.__drafts?.length, sent: window.__sent?.length }));
  const widgetStatus = await sw.evaluate(() => 'ok').catch(()=> 'dead');
  const panelTxt = (await panel.evaluate(() => document.body.innerText.replace(/\n+/g,' | ').slice(0,400))).slice(0,300);
  console.log(`t+${i*2}s drafts=${d.drafts} sent=${d.sent} panel=${panelTxt.slice(120,280)}`);
  if (d.drafts === 2) break;
  await page.waitForTimeout(2000);
}
// now try nav
console.log('click inbox-link');
await page.click('#inbox-link');
console.log('clicked');
await page.waitForSelector('.msg-list', { timeout: 5000 });
console.log('click drafts-link');
await page.click('.drafts-link');
await page.waitForTimeout(500);
console.log('draft items:', await page.locator('.draft-item').count());
await context.close();
