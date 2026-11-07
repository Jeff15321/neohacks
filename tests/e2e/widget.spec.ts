import { test, expect, request } from '@playwright/test';
import { launchWithExtension, openPanel, generate, approveFirst, waitForWidgetStatus, busLog, FIXTURE_URL, BASE, TOKEN } from './helpers.js';

const MOCK_REPLY = "Hi, thanks for reaching out. I've received your message and will follow up shortly with the details you need. Best regards.";

test.describe('AI widget end-to-end (mock LLM, fixture Gmail)', () => {
  test('generate -> approve -> run -> two drafts, nothing sent; bus log + llm_calls populated with one traceId', async () => {
    const { context, sw } = await launchWithExtension();
    try {
      const page = await context.newPage();
      await page.goto(FIXTURE_URL);
      await page.waitForSelector('.msg-row.unread');
      expect(await page.locator('.msg-row.unread').count()).toBe(2);

      const panel = await openPanel(context);
      const title = await generate(panel, 'Add a button that reads my two most recent unread emails and writes a friendly AI-generated reply draft for each.');
      expect(title).toContain('Unread Reply Drafter');
      // approval card shows the plain-language plan + grants before anything runs
      const card = await panel.locator('[data-testid="approval-card"]').first().innerText();
      expect(card).toMatch(/what it will do/i);
      expect(card).toContain('never sends');
      expect(await page.locator('div[id^="wwa-"]').count()).toBe(0); // nothing injected before approval

      await approveFirst(panel);
      const host = page.locator('.gj-toolbar div[id^="wwa-"]');
      await host.waitFor({ timeout: 15_000 });
      await page.locator('.gj-toolbar div[id^="wwa-"] >> css=button').click();

      await page.waitForFunction(() => (window as any).__drafts?.length === 2, undefined, { timeout: 60_000 });
      const drafts = await page.evaluate(() => (window as any).__drafts);
      const sent = await page.evaluate(() => (window as any).__sent);
      expect(drafts).toHaveLength(2);
      expect(drafts.map((d: any) => d.body)).toEqual([MOCK_REPLY, MOCK_REPLY]);
      expect(new Set(drafts.map((d: any) => d.msgId)).size).toBe(2);
      expect(sent).toHaveLength(0);
      await waitForWidgetStatus(panel, 'completed', 20_000);

      // host page still functions (SPA navigation intact)
      await page.click('#inbox-link');
      await page.waitForSelector('.msg-list');
      await page.click('.drafts-link');
      expect(await page.locator('.draft-item').count()).toBe(2);

      // --- debuggability: bus log + llm_calls, linked by traceId (panel → SW → backend → llm_calls) ---
      const log = await busLog(sw);
      const gen = log.find(e => e.type === 'GENERATE_WIDGET' && e.channel === 'panel');
      const approve = log.find(e => e.type === 'APPROVE_WIDGET');
      expect(gen?.ok).toBe(true);
      expect(approve?.ok).toBe(true);
      const inferences = log.filter(e => e.type === 'WIDGET_INFERENCE' && e.channel === 'userScript');
      expect(inferences.length).toBe(2);
      expect(inferences.every(e => e.ok && e.traceId === approve!.traceId)).toBe(true); // run inherits the approve traceId
      for (const t of ['WWA_NET_HELLO', 'WIDGET_STATUS', 'WIDGET_LOG']) expect(log.some(e => e.type === t)).toBe(true);

      const api = await request.newContext({ baseURL: BASE, extraHTTPHeaders: { 'x-extension-token': TOKEN } });
      const genCalls = (await (await api.get(`/api/debug/llm-calls?traceId=${gen!.traceId}`)).json()).calls;
      expect(genCalls.map((c: any) => c.stage)).toEqual(['generate.widget']);
      expect(genCalls[0].parseOk).toBe(true);
      expect(genCalls[0].model).toBe('claude-opus-5-5');
      const runCalls = (await (await api.get(`/api/debug/llm-calls?traceId=${approve!.traceId}`)).json()).calls;
      expect(runCalls.map((c: any) => c.stage)).toEqual(['inference', 'inference']);

      // Inspector renders both logs
      await panel.click('[data-testid="tab-inspector"]');
      await panel.click('[data-testid="bus-refresh"]');
      await expect(panel.locator('[data-testid="bus-log"]')).toContainText('GENERATE_WIDGET');
      await expect(panel.locator('[data-testid="bus-log"]')).toContainText('WIDGET_INFERENCE');
      await panel.click('[data-testid="llm-refresh"]');
      await expect(panel.locator('[data-testid="llm-calls"]')).toContainText('generate.widget');
      await expect(panel.locator('[data-testid="llm-calls"]')).toContainText('inference');
      await panel.screenshot({ path: 'test-results/inspector.png', fullPage: true });
      console.log(`[e2e] bus log ${log.length} entries; llm_calls gen=${genCalls.length} run=${runCalls.length}; traceIds gen=${gen!.traceId} run=${approve!.traceId}`);
    } finally {
      await context.close();
    }
  });
});
