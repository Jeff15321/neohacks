import { test, expect, request, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchWithExtension, openPanel, generate, approveFirst, waitForWidgetStatus, busLog, NET_URL, BASE } from './helpers.js';

const EVIDENCE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../docs/evidence/E');
const netOps = async (panel: Page) => {
  const r = await panel.evaluate(() => (globalThis as any).chrome.runtime.sendMessage({ type: 'GET_NET_OPS' }));
  expect(r.ok).toBe(true);
  return r.ops as any[];
};
const draftOp = (ops: any[]) => ops.find(o => o.method === 'POST' && o.path === '/fixture-api/drafts' && !o.replay);

test.describe('Network observation + reproduction (NetMail fixture, real API)', () => {
  test('user action → captured POST (webRequest-confirmed) → widget replays with new params → verified server-side', async () => {
    const { context, sw } = await launchWithExtension();
    try {
      const api = await request.newContext({ baseURL: BASE });
      await api.post('/fixture-api/__reset');

      const page = await context.newPage();
      await page.goto(NET_URL);
      await page.waitForSelector('tr.zA');
      expect(await page.locator('tr.zA.zE').count()).toBe(2);

      // 1. user performs the action manually → the page issues POST /fixture-api/drafts via fetch()
      await page.click('#compose-btn');
      await page.fill('#cm-to', 'user@example.com');
      await page.fill('#cm-subject', 'Manual draft');
      await page.fill('#cm-body', 'typed by the user through the UI');
      const draftResp = page.waitForResponse('**/fixture-api/drafts');
      await page.click('#cm-save');
      await draftResp;

      // 1b. a page script FORGES a probe record (doc §4 1b): it must show up unconfirmed and never be replayable
      await page.evaluate(() => window.postMessage({ source: 'wwa-net', kind: 'record', record: {
        id: 'forged1', tabId: -1, frameUrl: location.href, url: location.origin + '/fixture-api/send', method: 'POST',
        initiator: 'fetch', startTs: Date.now(), status: 200, ok: true, requestBody: '{"to":"evil@x.com"}' } }, location.origin));

      // 2. Inspector shows the captured op, correlated to the click, confirmed by webRequest
      const panel = await openPanel(context);
      await panel.click('[data-testid="tab-inspector"]');
      const net = panel.locator('[data-testid="net-ops"]');
      await expect(async () => {
        await panel.click('[data-testid="net-refresh"]');
        await expect(net).toContainText('/fixture-api/drafts', { timeout: 1000 });
        await expect(net).toContainText('/fixture-api/send', { timeout: 1000 });
      }).toPass({ timeout: 15_000 });
      const draftRow = net.locator('button', { hasText: '/fixture-api/drafts' }).first();
      await expect(draftRow).toContainText('POST');
      await expect(draftRow).toContainText('Save draft'); // gesture correlation
      await expect(draftRow).not.toContainText('unconfirmed');
      const forgedRow = net.locator('button', { hasText: '/fixture-api/send' }).first();
      await expect(forgedRow).toContainText('unconfirmed');
      const forgedReplay = await panel.evaluate(() => (globalThis as any).chrome.runtime.sendMessage({ type: 'NET_REPLAY', opId: 'forged1' }));
      expect(forgedReplay.ok).toBe(false);
      expect(forgedReplay.error).toMatch(/unconfirmed/);
      console.log('[e2e-net] real op confirmed + correlated; forged op unconfirmed and replay refused');

      // 2b. op analysis (doc §4 item 3): route template, token field, dependency on the rotating CSRF GET
      let ops = await netOps(panel);
      const op = draftOp(ops);
      expect(op?.confirmed).toBe(true);
      expect(op.analysis.templateKey).toBe('POST /fixture-api/drafts');
      expect(op.analysis.tokenFields).toContain('body.csrf');
      expect(op.analysis.paramFields).toEqual([]);
      const dep = op.analysis.dependsOn.find((d: any) => d.field === 'body.csrf');
      expect(dep).toMatchObject({ fromTemplate: 'GET /fixture-api/csrf', path: 'token' });
      expect(ops.find(o => o.id === dep.opId)?.path).toBe('/fixture-api/csrf');
      expect(op.analysis.idempotencyHint).toMatch(/not idempotent/);
      expect(op.attribution).toBe('window'); // no Step recorder yet → 6 s gesture window fallback
      expect(op.requestBodyTemplate).toContain('"csrf":"[REDACTED]"'); // token stays redacted for panel/LLM/widgets
      expect(op.tier).toBe('observed');
      console.log('[e2e-net] analysis:', JSON.stringify({ template: op.analysis.templateKey, tokens: op.analysis.tokenFields, dependsOn: op.analysis.dependsOn.map((d: any) => `${d.field}←${d.fromTemplate}.${d.path}`) }));

      // 2c. a verbatim replay carries the STALE single-use token → 403 surfaced honestly, tier not promoted
      const stale = await panel.evaluate((id) => (globalThis as any).chrome.runtime.sendMessage({ type: 'NET_REPLAY', opId: id }), op.id);
      expect(stale.ok).toBe(true);
      expect(stale.result.status).toBe(403);
      expect(stale.result.ok).toBe(false);
      expect(stale.result.bodyText).toMatch(/stale csrf/);
      expect((await (await api.get('/fixture-api/__csrf-stats')).json()).rejected).toBe(1);
      ops = await netOps(panel);
      expect(draftOp(ops).tier).toBe('observed');
      expect((await (await api.get('/fixture-api/drafts')).json()).drafts).toHaveLength(1);
      console.log('[e2e-net] stale-token replay → 403, tier stays observed');

      // 3. generate + approve a widget that replays the captured op with new params
      const title = await generate(panel, 'Add a button that creates an email draft using the captured save-draft API call.');
      console.log('[e2e-net] widget:', title);
      await approveFirst(panel);

      // 4. widget UI injected into the native toolbar; click it
      await page.waitForSelector('#nm-toolbar div[id^="wwa-"]', { timeout: 15_000 });
      await page.locator('#nm-toolbar div[id^="wwa-"] >> css=button').click();
      await waitForWidgetStatus(panel, 'completed', 30_000);

      // 5. verify REAL server-side state: manual draft + replayed draft, nothing sent
      const drafts = (await (await api.get('/fixture-api/drafts')).json()).drafts;
      expect(drafts).toHaveLength(2);
      const replayed = drafts.find((d: any) => d.subject === 'API-authored draft');
      expect(replayed?.to).toBe('devin+api@example.com');
      expect(replayed?.body).toContain('WidgetAI.net.invoke');
      expect(drafts.find((d: any) => d.subject === 'Manual draft')).toBeTruthy();
      const sent = (await (await api.get('/fixture-api/sent')).json()).sent;
      expect(sent).toHaveLength(0);
      console.log('[e2e-net] 2 drafts server-side (1 manual + 1 replayed), 0 sent');

      expect((await (await api.get('/fixture-api/__csrf-stats')).json()).rejected).toBe(1); // widget used a FRESH token

      // 5b. verification tiers (doc §4 item 4): the widget's replay → replayed, its read-back → reportVerified → verified
      ops = await netOps(panel);
      expect(draftOp(ops).tier).toBe('verified');
      expect(draftOp(ops).tierEvidence).toContain('API-authored draft');
      expect(ops.find(o => o.path === '/fixture-api/csrf')?.tier).toBe('replayed'); // GET re-fetched, never "verified" by itself
      const bus = await busLog(sw);
      const rv = bus.filter(e => e.type === 'WIDGET_NET_REPORT_VERIFIED');
      expect(rv.length).toBe(1);
      expect(rv[0]!.ok).toBe(true);
      expect(bus.filter(e => e.type === 'WIDGET_NET_INVOKE').length).toBe(2); // csrf re-fetch + draft replay
      await panel.click('[data-testid="tab-inspector"]');
      await panel.click('[data-testid="net-refresh"]');
      const verifiedRow = net.locator('button', { hasText: '/fixture-api/drafts' }).filter({ hasText: 'verified' }).first();
      await expect(verifiedRow).toBeVisible();
      await verifiedRow.click();
      await expect(net.locator('[data-testid="net-analysis"]').first()).toContainText('depends: body.csrf ← GET /fixture-api/csrf .token');
      fs.mkdirSync(EVIDENCE, { recursive: true });
      await panel.screenshot({ path: path.join(EVIDENCE, 'inspector-tiers.png'), fullPage: true });
      console.log('[e2e-net] draft op template tier = verified (Inspector + GET_NET_OPS)');

      // 6. the fixture's own Drafts view (driven by GET /fixture-api/drafts) shows both
      await page.click('#drafts-btn');
      await page.waitForSelector('.draft-item');
      expect(await page.locator('.draft-item').count()).toBe(2);
    } finally { await context.close(); }
  });
});
