import { test, expect } from '@playwright/test';
import { launchWithExtension, EXT_ID } from './helpers.js';

const G2_URL = 'http://127.0.0.1:8787/fixture-g2/index.html';

test.describe('Gmail-realistic fixture (obfuscated classes, aria affordances)', () => {
  test('draft replies to 2 unread via tr.zA.zE + role=link Reply', async () => {
    const { context } = await launchWithExtension();
    try {
      const page = await context.newPage();
      await page.goto(G2_URL);
      await page.waitForSelector('tr.zA.zE');
      expect(await page.locator('tr.zA.zE').count()).toBe(2);

      const panel = await context.newPage();
      await panel.goto(`chrome-extension://${EXT_ID}/sidepanel.html`);
      await panel.fill('#req', 'Add a button that reads my two most recent unread emails and writes a friendly AI reply draft for each.');
      await panel.click('#gen-btn');
      await panel.waitForSelector('.card h3', { timeout: 30_000 });
      await panel.click('button.primary:has-text("Approve & Run")');

      await page.waitForSelector('.G-atb div[id^="wwa-"]', { timeout: 15_000 });
      await page.locator('.G-atb div[id^="wwa-"] >> css=button').click();
      await page.waitForFunction(() => (window as any).__drafts?.length === 2, undefined, { timeout: 60_000 });

      const drafts = await page.evaluate(() => (window as any).__drafts);
      const sent = await page.evaluate(() => (window as any).__sent);
      expect(drafts).toHaveLength(2);
      expect(new Set(drafts.map((d: any) => d.msgId)).size).toBe(2);
      expect(sent).toHaveLength(0);
      await panel.waitForFunction(() => document.body.innerText.includes('completed'), undefined, { timeout: 15_000 });
      console.log('[e2e-g2] 2 drafts, 0 sent, completed on obfuscated DOM');
    } finally { await context.close(); }
  });
});
