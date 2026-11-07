import { test, expect, type Page } from '@playwright/test';
import { launchWithExtension, openPanel, generate, approveFirst, waitForWidgetStatus, busLog, G2_URL } from './helpers.js';

/**
 * Decision B — self-healing branching runtime (mock LLM, deterministic):
 * branch pick, new branch (+ learned-branch version), cap → failure narrative, danger guard.
 */
const REQUEST = 'Add a button that reads my two most recent unread emails and writes a friendly AI reply draft for each.';
type Run = { id: string; status: string; interventions: number; narrative?: string; events: Array<{ kind: string; step?: string; detail?: string; data?: any }>; learned: Array<{ step: string; id: string; status: string }> };

const runs = async (panel: Page): Promise<Run[]> => ((await panel.evaluate(`chrome.runtime.sendMessage({ type: 'GET_RUNS', limit: 10 })`)) as { runs: Run[] }).runs;
const latestRun = async (panel: Page, pred: (r: Run) => boolean = () => true, timeout = 30_000): Promise<Run> => {
  const t0 = Date.now();
  for (;;) {
    const r = (await runs(panel)).find(pred);
    if (r) return r;
    if (Date.now() - t0 > timeout) throw new Error('no matching run: ' + JSON.stringify((await runs(panel)).map(x => ({ s: x.status, k: x.events.map(e => e.kind) }))).slice(0, 2000));
    await new Promise(res => setTimeout(res, 300));
  }
};
const kinds = (r: Run) => r.events.map(e => e.kind);
const widgetButton = (page: Page) => page.locator('.G-atb div[id^="wwa-"] >> css=button').first();

async function setup(chaos: string, request = REQUEST) {
  const { context, sw } = await launchWithExtension();
  const page = await context.newPage();
  await page.goto(`${G2_URL}?chaos=${chaos}`);
  await page.waitForSelector('#app > *');
  const panel = await openPanel(context);
  await generate(panel, request);
  await approveFirst(panel);
  await page.waitForSelector('.G-atb div[id^="wwa-"]', { timeout: 15_000 });
  return { context, sw, page, panel };
}

test.describe('self-healing runtime (WidgetAI.step / assist / danger guard)', () => {
  test('branch pick: interstitial popup → agent picks the pre-generated dismiss-popup branch', async () => {
    const { context, page, panel, sw } = await setup('popup');
    try {
      await widgetButton(page).click();
      await page.waitForFunction(() => (window as any).__drafts?.length === 2, undefined, { timeout: 60_000 });
      await waitForWidgetStatus(panel, 'completed', 20_000);
      const r = await latestRun(panel, x => x.status === 'completed');
      const decide = r.events.filter(e => e.kind === 'assist-decide');
      expect(decide).toHaveLength(1);
      expect(decide[0].data.choice).toBe('dismiss-popup');
      expect(r.events.some(e => e.kind === 'branch-result' && e.data.branchId === 'dismiss-popup' && e.data.ok)).toBe(true);
      expect(kinds(r)).not.toContain('assist-create');
      expect(r.interventions).toBe(1);
      expect(await page.evaluate(() => (window as any).__sent.length)).toBe(0);
      // timeline is visible in the panel; assist traffic went over the bus
      await panel.locator('[data-testid="run-timeline"] button').first().click();
      await expect(panel.locator('[data-testid="run-event"][data-kind="assist-decide"]').first()).toBeVisible();
      const log = await busLog(sw);
      expect(log.some(e => e.type === 'WIDGET_ASSIST' && e.ok)).toBe(true);
      console.log('[e2e-runtime] branch pick: popup dismissed via pre-generated branch, 2 drafts, 1 intervention');
    } finally { await context.close(); }
  });

  test('new branch: renamed Reply → agent writes a branch (same worldId, JSON state), re-used for email 2, learned as a new version', async () => {
    const { context, page, panel } = await setup('renamed');
    try {
      await widgetButton(page).click();
      await page.waitForFunction(() => (window as any).__drafts?.length === 2, undefined, { timeout: 60_000 });
      await waitForWidgetStatus(panel, 'completed', 20_000);
      const r = await latestRun(panel, x => x.status === 'completed');
      const created = r.events.filter(e => e.kind === 'assist-create');
      expect(created).toHaveLength(1);
      expect(created[0].data.branchId).toBe('click-respond');
      expect(r.events.filter(e => e.kind === 'branch-result' && e.data.ok && e.data.source === 'create')).toHaveLength(1);
      expect(r.events.filter(e => e.kind === 'branch-result' && e.data.ok && e.data.source === 'learned')).toHaveLength(1);
      expect(r.learned).toEqual([expect.objectContaining({ step: 'open-reply', id: 'click-respond', status: 'pending' })]);
      expect(await page.evaluate(() => (window as any).__sent.length)).toBe(0);

      // "The agent fixed step X: add this branch?" → diff → new version that needs approval
      const offer = panel.locator('[data-testid="learned-branch"]');
      await expect(offer).toContainText('The agent fixed step “open-reply”');
      await expect(offer.locator('[data-testid="learned-diff"]')).toContainText('+ WidgetAI.addBranch("open-reply"');
      await offer.locator('[data-testid="learned-accept"]').click();
      const card = panel.locator('[data-testid="approval-card"]').first();
      await expect(card).toContainText('v2');
      await expect(card).toContainText('Added agent-learned branch "click-respond"');

      // approve v2 and run it on the renamed page again: the learned branch is now a pre-generated branch → no create
      await page.reload();
      await page.waitForSelector('tr.zA');
      await page.evaluate(() => { (window as any).__drafts = []; });
      await card.locator('[data-testid="approve"]').click();
      await page.waitForSelector('.G-atb div[id^="wwa-"]', { timeout: 15_000 });
      await widgetButton(page).click();
      await page.waitForFunction(() => (window as any).__drafts?.length === 2, undefined, { timeout: 60_000 });
      const r2 = await latestRun(panel, x => x.status === 'completed' && x.id !== r.id, 60_000);
      expect(kinds(r2)).not.toContain('assist-create');
      const d2 = r2.events.filter(e => e.kind === 'assist-decide');
      expect(d2.length).toBeGreaterThan(0);
      expect(d2.every(e => e.data.choice === 'click-respond')).toBe(true);
      expect(r2.events.some(e => e.kind === 'branch-run' && e.data.source === 'learned')).toBe(true);
      console.log('[e2e-runtime] new branch: click-respond written once, re-used, learned into v2; v2 run used it without create');
    } finally { await context.close(); }
  });

  test('cap → final-failure narrative: empty inbox → decide → create → escalate → stop', async () => {
    const { context, page, panel } = await setup('empty');
    try {
      await widgetButton(page).click();
      await waitForWidgetStatus(panel, 'failed', 60_000);
      const r = await latestRun(panel, x => x.status === 'failed');
      const k = kinds(r);
      for (const kind of ['expect-fail', 'assist-decide', 'assist-create', 'assist-escalate', 'cap', 'final-failure']) expect(k).toContain(kind);
      expect(r.events.find(e => e.kind === 'cap')?.detail).toMatch(/2 recovery attempts for step "find-unread"/);
      expect(r.interventions).toBe(2);
      expect(r.narrative).toMatch(/Step "find-unread" started/);
      expect(r.narrative).toMatch(/chose "new"/);
      expect(r.narrative).toMatch(/escalate/);
      expect(r.narrative).toMatch(/Why it broke: step "find-unread" never reached its postcondition .*Stopped because: cap: 2 recovery attempts/);
      expect(r.narrative).toMatch(/Your inbox is empty/); // DOM evidence
      // shown in the widget (in-page report) and the panel
      await expect(page.locator('[data-testid="wwa-run-report"]')).toContainText('find-unread');
      await expect(panel.locator('[data-testid="run-narrative"]')).toContainText('Why it broke');
      expect(await page.evaluate(() => (window as any).__drafts.length)).toBe(0);
      console.log('[e2e-runtime] cap: narrative\n' + r.narrative);
    } finally { await context.close(); }
  });

  test('danger guard: a script "Delete" click is blocked (fixture state unchanged) with a danger-blocked timeline event', async () => {
    const { context, page, panel } = await setup('guard', 'Add a button that cleans up the newsletter by deleting it.');
    try {
      await widgetButton(page).click();
      const confirm = page.locator('[data-testid="wwa-danger-confirm"]');
      await expect(confirm).toBeVisible({ timeout: 10_000 });
      await expect(confirm).toContainText('Delete');
      expect(await page.evaluate(() => (window as any).__deleted.length)).toBe(0);
      await confirm.locator('[data-testid="danger-block"]').click();
      await expect(confirm).toHaveCount(0);
      await page.waitForTimeout(800);
      expect(await page.evaluate(() => (window as any).__deleted.length)).toBe(0);
      await expect(page.locator('.hP')).toContainText('Weekly digest'); // still on the (not deleted) message
      const r = await latestRun(panel, x => x.events.some(e => e.kind === 'danger-blocked'));
      const ev = r.events.find(e => e.kind === 'danger-blocked')!;
      expect(ev.data.label).toBe('Delete');
      expect(ev.data.what).toBe('click');
      expect(kinds(r)).not.toContain('danger-allowed');
      // page scripts cannot press Allow (untrusted clicks are ignored)
      console.log('[e2e-runtime] danger guard blocked script Delete click; __deleted=0');
    } finally { await context.close(); }
  });
});
