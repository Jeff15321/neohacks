// Generic capture/replay probe for ANY real website (non-persistent profile).
//   TARGET=<url> [CLICK=<selector>] [REPLAY=1] npx tsx site-netprobe.mjs
// Loads the site with the extension, optionally clicks a selector to trigger
// traffic, then dumps the panel's captured ops. With REPLAY=1, re-issues the
// most recent captured GET verbatim via the panel replay path.
import { launchWithExtension, EXT_ID } from '../e2e/helpers.ts';

const TARGET = process.env.TARGET || 'https://reqres.in/';
const CLICK = process.env.CLICK;
const { context } = await launchWithExtension();
const page = await context.newPage();
await page.goto(TARGET, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(5000);

if (CLICK) {
  try {
    await page.locator(CLICK).first().click({ timeout: 8000 });
    console.log('clicked', CLICK);
    await page.waitForTimeout(4000);
  } catch (e) { console.log('click failed:', String(e).slice(0, 200)); }
}

const panel = await context.newPage();
await panel.goto(`chrome-extension://${EXT_ID}/sidepanel.html`);
await panel.click('[data-testid="tab-inspector"]'); await panel.click('[data-testid="net-refresh"]');
await panel.waitForTimeout(1500);
console.log('=== CAPTURED OPS ===');
console.log((await panel.locator('[data-testid="net-ops"]').innerText()).slice(0, 5000));

if (process.env.REPLAY === '1') {
  // expand the first op and hit its Replay button (verbatim re-issue)
  await panel.locator('.netline').first().click();
  await panel.locator('.netdetail button:has-text("Replay")').first().click();
  await panel.waitForTimeout(4000);
  console.log('=== AFTER REPLAY ===');
  console.log((await panel.locator('[data-testid="net-ops"]').innerText()).slice(0, 5000));
}
await context.close();
