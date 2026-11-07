import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import path from 'node:path';
import { launchWithExtension, openPanel, waitForWidgetStatus, busLog, G2_URL } from './helpers.js';

/**
 * Demo 2 (doc §8 Phase 4, mock LLM): passive observation → suggestion at the 2nd completed reply (not the 1st) →
 * speculative generation job → in-page card → Accept → approval card → install → drafts (0 sent).
 * "Never for this" suppresses the pattern.
 */
const msg = (panel: Page, m: Record<string, unknown>) => panel.evaluate(`chrome.runtime.sendMessage(${JSON.stringify(m)})`) as Promise<any>;
const activity = (panel: Page) => msg(panel, { type: 'ACTIVITY_GET' });
const completedOf = async (panel: Page) => ((await activity(panel)).state?.patterns?.[0]?.instanceIds?.length ?? 0) as number;
const CARD = '#wwa-suggestion-card';

async function setup(): Promise<{ context: BrowserContext; page: Page; panel: Page; sw: import('@playwright/test').Worker }> {
  const { context, sw } = await launchWithExtension();
  const panel = await openPanel(context);
  // observation is opt-in (default off) and suggestions are gated separately; content scripts read the flag on load
  const set = await msg(panel, { type: 'SET_SETTINGS', patch: { observe: true, suggestions: true } });
  expect(set.settings.observe && set.settings.suggestions).toBe(true);
  const page = await context.newPage();
  await page.goto(G2_URL);
  await page.waitForSelector('tr.zA');
  return { context, page, panel, sw };
}

/** The user manually replies to one email: open row → Reply → type (fixture auto-saves "Draft saved"). */
async function replyTo(page: Page, panel: Page, msgId: string, text: string, expectCompleted: number) {
  await page.bringToFront();
  if (!(await page.locator('table[role="grid"]').count())) await page.click('[aria-label="Back to Inbox"]');
  await page.click(`tr[data-legacy-message-id="${msgId}"]`);
  await page.waitForSelector('.a3s');
  await page.click('[aria-label="Reply"]');
  await page.waitForSelector('[aria-label="Message Body"]');
  await page.keyboard.type(text, { delay: 5 });
  await page.waitForSelector('#toast:not([hidden])', { timeout: 5_000 });
  // input commits after 1.5 s idle → settles → ObserveClient → backend Tier1/Tier2/(Judge) → state
  await expect.poll(() => completedOf(panel), { timeout: 15_000 }).toBe(expectCompleted);
}

test.describe('Proactive suggestions (Demo 2, mock LLM)', () => {
  test('2 manual replies → card after the 2nd (not the 1st) → job → Accept → approval → install → drafts, 0 sent', async () => {
    const { context, page, panel, sw } = await setup();
    try {
      const unreadAtStart = await page.locator('tr.zA.zE').count();
      expect(unreadAtStart).toBe(2);

      // --- 1st completed reply: pattern created (1 instance), NO suggestion
      await replyTo(page, panel, 'm1', 'Thanks Priya, I will review the checklist and confirm owners by Friday.', 1);
      await page.waitForTimeout(800); // give a (wrong) suggestion time to show up
      await expect(page.locator(CARD)).toHaveCount(0);
      const a1 = await activity(panel);
      expect(a1.suggestions).toHaveLength(0);
      expect(a1.state.recentCompleted.filter((t: any) => t.status === 'completed')).toHaveLength(1);
      expect(a1.diag.lastJudge).toMatch(/1 completed instance|not flagged/);

      // --- 2nd completed reply (a different email, the read digest): suggestion card appears
      await replyTo(page, panel, 'm3', 'Thanks for the digest, looks good.', 2);
      await page.waitForSelector(CARD, { state: 'attached', timeout: 10_000 });
      await expect(page.locator(`${CARD} [data-testid="sg-title"]`)).toContainText(/unread/i);
      await expect(page.locator(`${CARD} [data-testid="sg-why"]`)).toContainText(/2 emails/);
      // speculative generation job → ready
      await expect(page.locator(CARD)).toHaveAttribute('data-state', 'ready', { timeout: 20_000 });
      const a2 = await activity(panel);
      expect(a2.suggestions).toHaveLength(1);
      const sg = a2.suggestions[0];
      expect(sg.status).toBe('ready');
      expect(sg.jobId).toBeTruthy();
      const jobs = (await msg(panel, { type: 'JOBS_LIST' })).jobs;
      expect(jobs.find((j: any) => j.id === sg.jobId)?.status).toBe('succeeded');
      // nothing installed / nothing ran yet: suggestions never auto-run
      expect((await msg(panel, { type: 'LIST_WIDGETS' })).widgets).toHaveLength(0);
      if (process.env.EVIDENCE_DIR) await page.screenshot({ path: path.join(process.env.EVIDENCE_DIR, 'suggestion-card.png') });

      // Details expander lists the observed task instances
      await page.locator(`${CARD} summary`).click();
      await expect(page.locator(`${CARD} li`)).toHaveCount(2);

      // --- Accept → approval card in the panel (Create tab), unapproved
      await page.locator(`${CARD} button[data-a="accept"]`).click();
      await expect(page.locator(CARD)).toHaveCount(0, { timeout: 5_000 });
      await panel.bringToFront();
      const card = panel.locator('[data-testid="approval-card"]').first();
      await card.locator('h3').waitFor({ timeout: 10_000 });
      let widgets = (await msg(panel, { type: 'LIST_WIDGETS' })).widgets;
      expect(widgets).toHaveLength(1);
      expect(widgets[0].approved).toBe(false);
      expect(widgets[0].spec?.goal).toMatch(/unread/i);
      if (process.env.EVIDENCE_DIR) await panel.screenshot({ path: path.join(process.env.EVIDENCE_DIR, 'suggest-approval.png') });
      await card.locator('[data-testid="approve"]').click();
      await panel.locator('[data-testid="widget-card"]').first().waitFor({ timeout: 10_000 });
      widgets = (await msg(panel, { type: 'LIST_WIDGETS' })).widgets;
      expect(widgets[0].approved).toBe(true);

      // --- run: drafts for the remaining unread email (m2); the user's own 2 drafts stay; nothing sent
      await page.bringToFront();
      await page.locator('#wwa-spec-drafter button').click({ timeout: 15_000 });
      await page.waitForFunction('window.__drafts && window.__drafts.some(d => d.msgId === "m2")', undefined, { timeout: 60_000 });
      const drafts = await page.evaluate('window.__drafts') as Array<{ msgId: string }>;
      const sent = await page.evaluate('window.__sent') as unknown[];
      expect(new Set(drafts.map(d => d.msgId))).toEqual(new Set(['m1', 'm2', 'm3']));
      expect(sent).toHaveLength(0);
      await waitForWidgetStatus(panel, 'completed', 20_000);

      const a3 = await activity(panel);
      expect(a3.suggestions[0].status).toBe('accepted');
      expect(a3.suggestions[0].widgetId).toBe(widgets[0].id);
      const log = await busLog(sw);
      for (const t of ['WWA_STEP', 'WWA_SUGGESTION_ACTION', 'APPROVE_WIDGET']) expect(log.some(e => e.type === t && e.ok), t).toBe(true);
      expect(log.some(e => e.type === 'jobs.start' && e.ok)).toBe(true);
      expect(log.some(e => e.type === 'widgets.adopt' && e.ok)).toBe(true);

      // Activity tab + Inspector show the model's view
      await panel.click('[data-testid="tab-activity"]');
      await expect(panel.locator('[data-testid="pattern-count"]').first()).toContainText('2 completed');
      await expect(panel.locator('[data-testid="suggestion-row"]')).toHaveAttribute('data-status', 'accepted');
      await expect(panel.locator('[data-testid="completed-task"]')).toHaveCount(2);
      if (process.env.EVIDENCE_DIR) await panel.screenshot({ path: path.join(process.env.EVIDENCE_DIR, 'activity-tab.png'), fullPage: true });
      await panel.click('[data-testid="tab-inspector"]');
      await expect(panel.locator('[data-testid="pattern"]').first()).toContainText('p_reply_to_email');
      await expect(panel.locator('[data-testid="llm-call"]').filter({ hasText: 'observe.judge' }).first()).toBeVisible({ timeout: 10_000 });
      await expect(panel.locator('[data-testid="llm-call"]').filter({ hasText: 'observe.activity' }).first()).toBeVisible();
      console.log(`[e2e-suggest] suggestion "${sg.title}" → job ${sg.jobId} → widget ${widgets[0].name} → drafts ${drafts.map(d => d.msgId).join(',')}, sent ${sent.length}`);
    } finally { await context.close(); }
  });

  test('"Never for this" dismisses (job cancelled/discarded) and the pattern is never re-suggested', async () => {
    const { context, page, panel } = await setup();
    try {
      await replyTo(page, panel, 'm1', 'Thanks Priya, will do.', 1);
      await expect(page.locator(CARD)).toHaveCount(0);
      await replyTo(page, panel, 'm3', 'Thanks!', 2);
      await page.waitForSelector(CARD, { state: 'attached', timeout: 10_000 });
      await page.locator(`${CARD} button[data-a="never"]`).click();
      await expect(page.locator(CARD)).toHaveCount(0, { timeout: 5_000 });
      await expect.poll(async () => (await activity(panel)).suggestions[0]?.status).toBe('dismissed');
      await expect.poll(async () => ((await activity(panel)).state?.dismissed ?? []).map((d: any) => d.patternId)).toContain('p_reply_to_email');

      // a 3rd completed instance of the same pattern → no new suggestion, no card
      await replyTo(page, panel, 'm2', 'Count me in for Saturday.', 3);
      await page.waitForTimeout(1000);
      await expect(page.locator(CARD)).toHaveCount(0);
      const a = await activity(panel);
      expect(a.suggestions).toHaveLength(1);
      expect(a.diag.lastJudge).toMatch(/dismissed/);
      expect((await msg(panel, { type: 'LIST_WIDGETS' })).widgets).toHaveLength(0);

      // dismissed items are restorable from the Activity tab
      await panel.bringToFront();
      await panel.click('[data-testid="tab-activity"]');
      await expect(panel.locator('[data-testid="suggestion-row"]')).toHaveAttribute('data-status', 'dismissed');
      await panel.click('[data-testid="sg-restore"]');
      await expect(panel.locator('[data-testid="suggestion-row"]')).toHaveAttribute('data-status', /ready|generating/, { timeout: 10_000 });
      expect(((await activity(panel)).state?.dismissed ?? []).length).toBe(0);
    } finally { await context.close(); }
  });
});
