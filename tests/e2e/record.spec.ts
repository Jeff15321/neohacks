import { test, expect, type Page, type Worker } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchWithExtension, openPanel, waitForWidgetStatus, busLog, G2_URL } from './helpers.js';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const msg = (panel: Page, m: Record<string, unknown>) => panel.evaluate(`chrome.runtime.sendMessage(${JSON.stringify(m)})`) as Promise<any>;
const badge = (sw: Worker) => sw.evaluate('chrome.action.getBadgeText({})') as Promise<string>;
const recSteps = async (panel: Page) => ((await msg(panel, { type: 'REC_GET' })).steps ?? []) as any[];

test.describe('Recording → WorkflowSpec → widget (Demo 1, mock LLM)', () => {
  test('record 1 reply on HardMail → spec (goal + slots) → generate → approve → drafts for the remaining unread, 0 sent', async () => {
    const { context, sw } = await launchWithExtension();
    try {
      const page = await context.newPage();
      await page.goto(G2_URL);
      await page.waitForSelector('tr.zA.zE');
      const unreadAtStart = await page.locator('tr.zA.zE').count();
      expect(unreadAtStart).toBe(2);
      const panel = await openPanel(context);

      // --- start via PanelToSW message (E1: synthetic keys are not relied on)
      const started = await msg(panel, { type: 'REC_START' });
      expect(started.ok, started.error).toBe(true);
      expect(started.session.status).toBe('recording');
      await expect.poll(() => badge(sw)).toBe('REC');
      await page.waitForSelector('#wwa-rec-pill', { state: 'attached', timeout: 5_000 });

      // --- the user replies to ONE email
      await page.click('tr.zA.zE >> nth=0');
      await page.waitForSelector('.a3s');
      await page.click('[aria-label="Reply"]');
      await page.waitForSelector('[aria-label="Message Body"]');
      await page.keyboard.type('Thanks Priya, I will review the checklist and confirm owners by Friday.', { delay: 5 });
      await page.waitForSelector('#toast:not([hidden])', { timeout: 5_000 });
      // input commits after 1.5 s idle, then settles (400 ms quiet)
      await expect.poll(async () => (await recSteps(panel)).filter(s => s.action.kind === 'input-commit').length, { timeout: 8_000 }).toBe(1);

      // live timeline in the Record tab (raw row + Tier-1 meaning row)
      await panel.click('[data-testid="tab-record"]');
      await expect(panel.locator('[data-testid="step-row"]')).toHaveCount(3, { timeout: 5_000 });
      await expect(panel.locator('[data-testid="step-meaning"]').filter({ hasText: 'reply' }).first()).toBeVisible();

      const stopped = await msg(panel, { type: 'REC_STOP' });
      expect(stopped.ok, stopped.error).toBe(true);
      await expect.poll(() => badge(sw)).toBe('');
      await expect(page.locator('#wwa-rec-pill')).toHaveCount(0);

      // --- Steps: open row → reply (composer appeared) → type (Draft saved), seq monotonic, value redacted-preview only
      const steps = await recSteps(panel);
      expect(steps.map(s => s.action.kind)).toEqual(['click', 'click', 'input-commit']);
      expect(steps.map(s => s.seq)).toEqual([...steps.map(s => s.seq)].sort((a, b) => a - b));
      expect(steps[0].action.target.candidates.some((c: any) => c.selector === 'tr[data-legacy-message-id="m1"]' && c.matches === 1)).toBe(true);
      expect(steps[1].action.accessibleName).toBe('Reply');
      expect(steps[1].effects.addedRegions.map((r: any) => r.skeleton).join('\n')).toContain('Message Body');
      const live = [...steps[2].effects.liveRegionText, ...(steps[2].lateEffects?.liveRegionText ?? [])];
      expect(live).toContain('Draft saved');
      expect(steps[2].action.valuePreview).toContain('Thanks Priya');
      console.log('[e2e-rec] steps', steps.map(s => `${s.seq}:${s.action.kind}:${s.settle?.reason}:${s.tEnd - s.tStart}ms`).join(' '));

      // --- review sheet: spec with goal + slots (auto-interpreted on stop)
      await expect(panel.locator('[data-testid="spec-goal"]')).toContainText(/unread/i, { timeout: 15_000 });
      expect(await panel.locator('[data-testid="spec-slot"]').count()).toBeGreaterThanOrEqual(1);
      await expect(panel.locator('[data-testid="spec-consequential"]')).toContainText(/send/i);
      await panel.fill('#rec-instructions', 'Draft only, do all unread emails. Run from a toolbar button.');
      await panel.click('[data-testid="rec-generate"]');
      const card = panel.locator('[data-testid="record-tab"] [data-testid="approval-card"]');
      await card.locator('h3').waitFor({ timeout: 30_000 });
      await expect(card.locator('h3')).toContainText('Recorded');
      await card.locator('[data-testid="approve"]').click();
      await panel.locator('[data-testid="widget-card"]').first().waitFor({ timeout: 10_000 });

      const widgets = (await msg(panel, { type: 'LIST_WIDGETS' })).widgets;
      expect(widgets[0].spec?.goal).toMatch(/unread/i); // WidgetRecord.spec saved

      // --- run: drafts for the remaining unread emails, nothing sent
      await page.locator('#wwa-spec-drafter button').click({ timeout: 15_000 });
      await page.waitForFunction('window.__drafts && window.__drafts.length === 2', undefined, { timeout: 60_000 });
      const drafts = await page.evaluate('window.__drafts') as Array<{ msgId: string }>;
      const sent = await page.evaluate('window.__sent') as unknown[];
      expect(drafts).toHaveLength(unreadAtStart);
      expect(new Set(drafts.map(d => d.msgId))).toEqual(new Set(['m1', 'm2']));
      expect(sent).toHaveLength(0);
      await waitForWidgetStatus(panel, 'completed', 20_000);
      expect(await page.locator('tr.zA.zE').count()).toBe(0);

      // --- Inspector: Steps + LLM calls + bus log; export debug bundle is valid JSON
      await panel.click('[data-testid="tab-inspector"]');
      await expect(panel.locator('[data-testid="step-log-row"]').first()).toBeVisible();
      await expect(panel.locator('[data-testid="llm-call"]').filter({ hasText: 'recordings.interpret' }).first()).toBeVisible();
      await expect(panel.locator('[data-testid="llm-call"]').filter({ hasText: 'steps.interpret' }).first()).toBeVisible();
      await expect(panel.locator('[data-testid="llm-call"]').filter({ hasText: 'generate.widget' }).first()).toBeVisible();
      await expect(panel.locator('[data-testid="bus-log"]')).toContainText('REC_START');
      const [dl] = await Promise.all([panel.waitForEvent('download'), panel.click('[data-testid="export-bundle"]')]);
      const bundle = JSON.parse(fs.readFileSync((await dl.path())!, 'utf8'));
      expect(bundle.kind).toBe('wwa-debug-bundle');
      expect(bundle.steps.length).toBeGreaterThanOrEqual(3);
      expect(bundle.recording.spec.goal).toMatch(/unread/i);
      expect(bundle.llmCalls.map((c: any) => c.stage)).toEqual(expect.arrayContaining(['steps.interpret', 'recordings.interpret', 'generate.widget', 'inference']));
      expect(bundle.busLog.length).toBeGreaterThan(5);
      expect(bundle.widgets[0].code.length).toBeGreaterThan(100);
      expect(bundle.widgets[0].version).toBe(1);
      expect(bundle.runTimeline[0].logs.length).toBeGreaterThan(0);

      const log = await busLog(sw);
      for (const t of ['REC_START', 'WWA_STEP', 'REC_STOP', 'REC_GENERATE', 'APPROVE_WIDGET']) expect(log.some(e => e.type === t && e.ok), t).toBe(true);

      if (process.env.UPDATE_TRACES === '1') {
        const [tl] = await Promise.all([panel.waitForEvent('download'), panel.click('[data-testid="export-trace"]')]);
        const trace = JSON.parse(fs.readFileSync((await tl.path())!, 'utf8'));
        fs.writeFileSync(path.join(DIR, '../traces/gmail2-reply.capture.json'), JSON.stringify(trace, null, 1));
      }
      console.log(`[e2e-rec] ${steps.length} steps → spec "${bundle.recording.spec.goal}" → ${drafts.length} drafts, ${sent.length} sent`);
    } finally { await context.close(); }
  });

  test('REC pill click stops; typed password never reaches Steps/exports; E1 synthetic Alt+Shift+R', async () => {
    const { context, sw } = await launchWithExtension();
    try {
      const page = await context.newPage();
      await page.goto(G2_URL);
      await page.waitForSelector('tr.zA.zE');
      const panel = await openPanel(context);

      // E1: does a Playwright-synthesised Alt+Shift+R reach chrome.commands? (recorded, not required)
      await page.bringToFront();
      await page.keyboard.press('Alt+Shift+R');
      await page.waitForTimeout(800);
      const e1 = await sw.evaluate('globalThis.__wwaRecord.commandLog.length') as number;
      console.log(`[e2e-rec] E1 headless: chrome.commands.onCommand fired ${e1} time(s) for synthetic Alt+Shift+R`);
      if (e1 % 2 === 1) await msg(panel, { type: 'REC_STOP' }); // if it toggled on, reset

      expect((await msg(panel, { type: 'REC_START' })).ok).toBe(true);
      await page.waitForSelector('#wwa-rec-pill', { state: 'attached' });
      await page.evaluate(`(() => { const i = document.createElement('input'); i.type = 'password'; i.id = 'pw'; i.setAttribute('aria-label', 'Password'); document.querySelector('.G-atb').appendChild(i); })()`);
      await page.waitForTimeout(500); // the inserted input is its own (unattributed) mutation
      await page.click('#pw');
      await page.keyboard.type('hunter2-SuperSecret!');
      await page.click('#drafts-nav'); // blur → commit
      await expect.poll(async () => (await recSteps(panel)).length, { timeout: 6_000 }).toBeGreaterThanOrEqual(3);

      // pill click = stop
      await page.locator('#wwa-rec-pill button').click();
      await expect.poll(() => badge(sw)).toBe('');
      const rec = await msg(panel, { type: 'REC_GET' });
      expect(rec.session.status).not.toBe('recording');
      const pwStep = rec.steps.find((s: any) => s.action.kind === 'input-commit');
      expect(pwStep.action.valuePreview).toBe('[REDACTED]');

      await panel.click('[data-testid="tab-inspector"]');
      const [dl] = await Promise.all([panel.waitForEvent('download'), panel.click('[data-testid="export-bundle"]')]);
      const text = fs.readFileSync((await dl.path())!, 'utf8');
      JSON.parse(text);
      expect(text).not.toContain('hunter2');
      expect(text).not.toContain('SuperSecret');
      console.log('[e2e-rec] pill stop ok; password redacted in Steps + bundle');
    } finally { await context.close(); }
  });
});
