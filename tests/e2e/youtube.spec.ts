import { test } from '@playwright/test';
import { launchWithExtension, openPanel, generate, approveFirst, waitForWidgetStatus, YT_URL } from './helpers.js';

test.describe('Generality: different site, different widget (YouTube fixture)', () => {
  test('comment topic analyzer injects panel and renders inference result', async () => {
    const { context } = await launchWithExtension();
    try {
      const page = await context.newPage();
      await page.goto(YT_URL);
      await page.waitForSelector('.comment');

      const panel = await openPanel(context);
      const title = await generate(panel, 'Add a widget that analyzes the comments on this video and groups them into the most common discussion topics.');
      console.log('[e2e-yt] card:', title);
      await approveFirst(panel);

      await page.waitForSelector('div[id^="wwa-"]', { timeout: 15_000 });
      await page.locator('div[id^="wwa-"] >> css=button').first().click();
      await page.waitForFunction(() => {
        const h = document.querySelector('div[id^="wwa-"]');
        return h?.shadowRoot?.querySelector('pre')?.textContent?.includes('Rust vs Go');
      }, undefined, { timeout: 30_000 });
      console.log('[e2e-yt] topic analysis rendered');
      await waitForWidgetStatus(panel, 'completed', 15_000);
    } finally { await context.close(); }
  });
});
