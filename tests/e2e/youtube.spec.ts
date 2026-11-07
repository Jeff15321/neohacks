import { test, expect } from '@playwright/test';
import { launchWithExtension, EXT_ID } from './helpers.js';

const YT_URL = 'http://127.0.0.1:8787/fixture-yt/index.html';

test.describe('Generality: different site, different widget (YouTube fixture)', () => {
  test('comment topic analyzer injects panel and renders inference result', async () => {
    const { context } = await launchWithExtension();
    try {
      const page = await context.newPage();
      await page.goto(YT_URL);
      await page.waitForSelector('.comment');

      const panel = await context.newPage();
      await panel.goto(`chrome-extension://${EXT_ID}/sidepanel.html`);
      await panel.fill('#req', 'Add a widget that analyzes the comments on this video and groups them into the most common discussion topics.');
      await panel.click('#gen-btn');
      await panel.waitForSelector('.card h3', { timeout: 30_000 });
      const cardText = await panel.locator('.card').first().innerText();
      console.log('[e2e-yt] card:', cardText.split('\n').slice(0, 3).join(' | '));

      await panel.click('button.primary:has-text("Approve & Run")');
      // widget inserts its panel above the comments heading
      await page.waitForSelector('div[id^="wwa-"]', { timeout: 15_000 });
      await page.locator('div[id^="wwa-"] >> css=button').first().click();

      // inference result renders inside widget shadow DOM
      await page.waitForFunction(() => {
        const h = document.querySelector('div[id^="wwa-"]');
        return h?.shadowRoot?.querySelector('pre')?.textContent?.includes('Rust vs Go');
      }, undefined, { timeout: 30_000 });
      console.log('[e2e-yt] topic analysis rendered');
      await panel.waitForFunction(() => document.body.innerText.includes('completed'), undefined, { timeout: 15_000 });
    } finally { await context.close(); }
  });
});
