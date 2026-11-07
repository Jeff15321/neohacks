// Capture-only probe on real Gmail: does the MAIN-world netprobe see Gmail's
// API traffic? Loads the persistent .gmail-profile, opens Gmail, then reads
// captured ops from the side panel's Network section. No replaying.
// Usage: cd tests/tools && npx tsx gmail-netprobe.mjs
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(DIR, '../../apps/extension/dist');
const EXT_ID = 'jbdmmaojlbiclmjbafphlchlnppplpen';
const PROFILE = path.join(DIR, '.gmail-profile');

const context = await chromium.launchPersistentContext(PROFILE, {
  channel: 'chromium',
  headless: false,
  // AutomationControlled removal sometimes lets Google sign-in proceed;
  // if Google still flags the browser as insecure there is no workaround
  // short of a manual Chrome session — see docs/network-observation.md.
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--disable-blink-features=AutomationControlled'],
});
const sw = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 20000 });

const page = await context.newPage();
await page.goto('https://mail.google.com/mail/u/0/#inbox');
console.log('waiting for inbox (log in manually if needed)…');
try {
  await page.waitForSelector('tr.zA', { timeout: 60000 });
  console.log('inbox loaded');
} catch {
  console.log('inbox not detected within 60s — probably logged out');
}
// interact a bit to generate traffic: open the first thread if present
try {
  await page.locator('tr.zA').first().click();
  await page.waitForTimeout(4000);
} catch {}
await page.waitForTimeout(4000);

const panel = await context.newPage();
await panel.goto(`chrome-extension://${EXT_ID}/sidepanel.html`);
await panel.click('[data-testid="tab-inspector"]'); await panel.click('[data-testid="net-refresh"]');
await panel.waitForTimeout(1500);
const text = await panel.locator('[data-testid="net-ops"]').innerText();
console.log('=== CAPTURED OPS ===');
console.log(text.slice(0, 4000));
await context.close();
