// Live Demo-1 run (Phase B): record one reply on the HardMail fixture → stop → Workflow Interpreter (Opus) →
// Generate (Opus) → approve → click the widget → expect a draft for every remaining unread email, 0 sent.
// Needs a backend with LLM_PROVIDER=anthropic on E2E_PORT and an extension built for it:
//   BACKEND_PORT=8802 LLM_PROVIDER=anthropic DATA_DB_PATH=/tmp/nx-b.db npm run start -w apps/backend
//   BACKEND_URL=http://127.0.0.1:8802 npm run build
//   cd tests/tools && E2E_PORT=8802 RUN=1 npx tsx record-live.mjs
// Writes docs/evidence/B/live-run-<RUN>.json (no LLM inputs; trace ids + outcome + generated code).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchWithExtension, openPanel, G2_URL } from '../e2e/helpers.ts';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const RUN = process.env.RUN ?? String(Date.now());
const OUT = path.resolve(DIR, '../../docs/evidence/B');
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(`[run ${RUN}]`, ...a);
const msg = (panel, m) => panel.evaluate(`chrome.runtime.sendMessage(${JSON.stringify(m)})`);
const t0 = Date.now();
const result = { run: RUN, ok: false, phase: 'start', timings: {} };

const { context, sw } = await launchWithExtension();
try {
  const page = await context.newPage();
  await page.goto(G2_URL);
  await page.waitForSelector('tr.zA.zE');
  const panel = await openPanel(context);

  const st = await msg(panel, { type: 'REC_START' });
  if (!st.ok) throw new Error('REC_START: ' + st.error);
  await page.waitForSelector('#wwa-rec-pill', { state: 'attached' });
  await page.click('tr.zA.zE >> nth=0');
  await page.waitForSelector('.a3s');
  await page.click('[aria-label="Reply"]');
  await page.waitForSelector('[aria-label="Message Body"]');
  await page.keyboard.type('Thanks Priya! I will review the checklist and confirm owners for items 3 and 7 by Friday.', { delay: 8 });
  await page.waitForSelector('#toast:not([hidden])', { timeout: 6000 });
  await page.waitForTimeout(2500);
  const stop = await msg(panel, { type: 'REC_STOP' });
  if (!stop.ok) throw new Error('REC_STOP: ' + stop.error);
  result.phase = 'interpret';
  const tI = Date.now();
  let rec;
  for (;;) {
    rec = await msg(panel, { type: 'REC_GET' });
    if (rec.session?.status === 'ready' && rec.spec) break;
    if (rec.session?.error) throw new Error('interpret: ' + rec.session.error);
    if (Date.now() - tI > 300_000) throw new Error('interpret timeout');
    await page.waitForTimeout(2000);
  }
  result.timings.interpretMs = Date.now() - tI;
  result.steps = rec.steps.map(s => ({ seq: s.seq, kind: s.action.kind, name: s.action.accessibleName, live: s.effects.liveRegionText, regions: s.effects.addedRegions.length, settle: s.settle }));
  result.semantic = rec.semantic;
  result.spec = rec.spec;
  log('spec goal:', rec.spec.goal, '| slots:', rec.spec.inputs.map(i => i.name).join(', '), '| questions:', rec.spec.openQuestions.length);

  result.phase = 'generate';
  await panel.click('[data-testid="tab-record"]');
  await panel.fill('#rec-instructions', 'Draft only (never send). Do all unread emails. Run from a toolbar button.');
  const tG = Date.now();
  await panel.click('[data-testid="rec-generate"]');
  const card = panel.locator('[data-testid="record-tab"] [data-testid="approval-card"]');
  await Promise.race([
    card.locator('h3').waitFor({ timeout: 330_000 }),
    panel.locator('[data-testid="error"]').waitFor({ timeout: 330_000 }).then(async () => { throw new Error('generate: ' + await panel.locator('[data-testid="error"]').innerText()); }),
  ]);
  result.timings.generateMs = Date.now() - tG;
  result.widgetName = await card.locator('h3').innerText();
  log('widget:', result.widgetName, `(${Math.round(result.timings.generateMs / 1000)} s)`);
  await card.locator('[data-testid="approve"]').click();

  result.phase = 'run';
  const btn = page.locator('[id^="wwa-"]:not(#wwa-rec-pill) button').first();
  await btn.waitFor({ timeout: 20_000 });
  await btn.click();
  const tR = Date.now();
  let status = '';
  while (Date.now() - tR < 150_000) {
    const d = await page.evaluate('({ d: (window.__drafts||[]).map(x => x.msgId), s: (window.__sent||[]).length, unread: document.querySelectorAll("tr.zA.zE").length })');
    const widgets = (await msg(panel, { type: 'LIST_WIDGETS' })).widgets ?? [];
    status = widgets[0]?.status ?? '';
    result.drafts = d.d; result.sent = d.s;
    if (d.s > 0) break;
    if (d.d.includes('m2') && (status === 'completed' || status === 'failed' || Date.now() - tR > 20_000)) break;
    if (status === 'failed') break;
    await page.waitForTimeout(1500);
  }
  result.timings.runMs = Date.now() - tR;
  result.widgetStatus = status;
  const widgets = (await msg(panel, { type: 'LIST_WIDGETS' })).widgets ?? [];
  result.widget = { id: widgets[0]?.id, version: widgets[0]?.version, lastError: widgets[0]?.lastError, specSaved: !!widgets[0]?.spec, code: widgets[0]?.code };
  result.ok = (result.drafts ?? []).includes('m2') && result.sent === 0 && status !== 'failed';
  result.phase = 'done';
  const calls = (await msg(panel, { type: 'GET_LLM_CALLS', limit: 30 })).calls ?? [];
  result.llmCalls = calls.map(c => ({ stage: c.stage, model: c.model, effort: c.effort, traceId: c.traceId, latencyMs: c.latencyMs, inputTokens: c.inputTokens, outputTokens: c.outputTokens, parseOk: c.parseOk, error: c.error }));
} catch (e) {
  result.error = String(e?.message ?? e);
  log('ERROR', result.error);
  try {
    const panel = context.pages().find(p => p.url().startsWith('chrome-extension://'));
    if (panel) {
      const calls = (await msg(panel, { type: 'GET_LLM_CALLS', limit: 30 })).calls ?? [];
      result.llmCalls = calls.map(c => ({ stage: c.stage, model: c.model, traceId: c.traceId, latencyMs: c.latencyMs, parseOk: c.parseOk, error: c.error }));
    }
  } catch { /* ignore */ }
} finally {
  result.totalMs = Date.now() - t0;
  fs.writeFileSync(path.join(OUT, `live-run-${RUN}.json`), JSON.stringify(result, null, 1));
  log(result.ok ? 'PASS' : 'FAIL', `drafts=${JSON.stringify(result.drafts)} sent=${result.sent} status=${result.widgetStatus} phase=${result.phase} total=${Math.round(result.totalMs / 1000)}s`);
  await context.close();
  void sw;
}
