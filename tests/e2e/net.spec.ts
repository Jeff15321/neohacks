import { test, expect, request } from '@playwright/test';
import { launchWithExtension, EXT_ID } from './helpers.js';

const NET_URL = 'http://127.0.0.1:8787/fixture-net/index.html';

test.describe('Network observation + reproduction (NetMail fixture, real API)', () => {
  test('user action → captured POST → widget replays with new params → verified server-side', async () => {
    const { context } = await launchWithExtension();
    try {
      const api = await request.newContext({ baseURL: 'http://127.0.0.1:8787' });
      await api.post('/fixture-api/__reset');

      const page = await context.newPage();
      await page.goto(NET_URL);
      await page.waitForSelector('tr.zA');
      expect(await page.locator('tr.zA.zE').count()).toBe(2);

      // 1. user performs the action manually: compose + save draft
      //    → the page issues POST /fixture-api/drafts via fetch()
      await page.click('#compose-btn');
      await page.fill('#cm-to', 'user@example.com');
      await page.fill('#cm-subject', 'Manual draft');
      await page.fill('#cm-body', 'typed by the user through the UI');
      const draftResp = page.waitForResponse('**/fixture-api/drafts');
      await page.click('#cm-save');
      await draftResp;

      // 2. panel Network inspector shows the captured op, correlated to the click
      const panel = await context.newPage();
      await panel.goto(`chrome-extension://${EXT_ID}/sidepanel.html`);
      await panel.click('#net-toggle');
      await panel.waitForFunction(
        () => document.body.innerText.includes('/fixture-api/drafts'),
        undefined, { timeout: 10_000 });
      const netText = await panel.locator('.card.net').innerText();
      expect(netText).toContain('POST');
      expect(netText).toContain('Save draft'); // gesture correlation
      console.log('[e2e-net] captured op visible in panel with trigger correlation');

      // 3. generate + approve a widget that replays the captured op with new params
      await panel.fill('#req', 'Add a button that creates an email draft using the captured save-draft API call.');
      await panel.click('#gen-btn');
      await panel.waitForSelector('.card h3', { timeout: 30_000 });
      const cardText = await panel.locator('.card h3').first().innerText();
      console.log('[e2e-net] widget:', cardText);
      await panel.click('button.primary:has-text("Approve & Run")');

      // 4. widget UI injected into the native toolbar; click it
      await page.waitForSelector('#nm-toolbar div[id^="wwa-"]', { timeout: 15_000 });
      await page.locator('#nm-toolbar div[id^="wwa-"] >> css=button').click();
      await panel.waitForFunction(() => document.body.innerText.includes('completed'), undefined, { timeout: 30_000 });

      // 5. verify REAL server-side state: manual draft + replayed draft, nothing sent
      const drafts = (await (await api.get('/fixture-api/drafts')).json()).drafts;
      expect(drafts).toHaveLength(2);
      const replayed = drafts.find((d: any) => d.subject === 'API-authored draft');
      expect(replayed).toBeTruthy();
      expect(replayed.to).toBe('devin+api@example.com');
      expect(replayed.body).toContain('WidgetAI.net.invoke');
      const manual = drafts.find((d: any) => d.subject === 'Manual draft');
      expect(manual).toBeTruthy();
      const sent = (await (await api.get('/fixture-api/sent')).json()).sent;
      expect(sent).toHaveLength(0);
      console.log('[e2e-net] 2 drafts server-side (1 manual + 1 replayed), 0 sent');

      // 6. the fixture's own Drafts view (driven by GET /fixture-api/drafts) shows both
      await page.click('#drafts-btn');
      await page.waitForSelector('.draft-item');
      expect(await page.locator('.draft-item').count()).toBe(2);
    } finally { await context.close(); }
  });
});
