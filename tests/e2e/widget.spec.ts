import { test, expect } from '@playwright/test';
import { launchWithExtension, FIXTURE_URL, EXT_ID } from './helpers.js';

const MOCK_REPLY = "Hi, thanks for reaching out. I've received your message and will follow up shortly with the details you need. Best regards.";

test.describe('AI widget end-to-end (mock LLM, fixture Gmail)', () => {
  test('generate -> approve -> run -> two drafts created, nothing sent', async () => {
    const { context, sw } = await launchWithExtension();
    try {
      // 1. open the fixture gmail
      const page = await context.newPage();
      await page.goto(FIXTURE_URL);
      await page.waitForSelector('.msg-row.unread');

      // sanity: 2 unread rows
      expect(await page.locator('.msg-row.unread').count()).toBe(2);

      // 2. open the side panel UI as an extension page (same UI as the real side panel)
      const panel = await context.newPage();
      await panel.goto(`chrome-extension://${EXT_ID}/sidepanel.html`);
      await panel.waitForSelector('#req');

      // 3. submit a natural-language request
      await panel.fill('#req', 'Add a button that reads my two most recent unread emails and writes a friendly AI-generated reply draft for each.');
      await panel.click('#gen-btn');
      await panel.waitForSelector('.card h3', { timeout: 30_000 });
      const cardText = await panel.locator('.card').first().innerText();
      console.log('[e2e] widget card:', cardText.split('\n').slice(0, 3).join(' | '));

      // 4. approve & run
      await panel.click('button.primary:has-text("Approve & Run")');

      // 5. widget UI must appear inside the fixture's native toolbar
      const host = page.locator('.gj-toolbar div[id^="wwa-"]');
      await host.waitFor({ timeout: 15_000 });
      console.log('[e2e] widget injected into native toolbar');

      // 6. click the widget's button (inside its shadow root)
      await page.locator('.gj-toolbar div[id^="wwa-"] >> css=button').click();

      // 7. workflow runs: 2 drafts appear via autosave
      await page.waitForFunction(() => (window as any).__drafts?.length === 2, undefined, { timeout: 60_000 });
      const drafts = await page.evaluate(() => (window as any).__drafts);
      const sent = await page.evaluate(() => (window as any).__sent);
      console.log('[e2e] drafts:', JSON.stringify(drafts?.map((d: any) => ({ msgId: d.msgId, len: d.body.length }))));

      expect(drafts).toHaveLength(2);
      expect(drafts.map((d: any) => d.body)).toEqual([MOCK_REPLY, MOCK_REPLY]);
      expect(new Set(drafts.map((d: any) => d.msgId)).size).toBe(2);   // correct threads
      expect(sent).toHaveLength(0);                                    // nothing sent

      // 8. widget reported completion to the extension
      await panel.waitForFunction(() => document.body.innerText.includes('completed'), undefined, { timeout: 20_000 });

      // 9. host page still functions (SPA navigation intact)
      await page.click('#inbox-link');
      await page.waitForSelector('.msg-list');
      await page.click('.drafts-link');
      const draftItems = await page.locator('.draft-item').count();
      expect(draftItems).toBe(2);
      console.log('[e2e] host SPA still works; drafts view shows', draftItems);
    } finally {
      await context.close();
    }
  });
});
