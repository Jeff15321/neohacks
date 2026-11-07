// Live Demo-2 run (Phase D): observation on → the user manually replies to 2 HardMail emails → live Tier1 (Haiku) /
// Tier2 (Sonnet) / Judge (Opus) → suggestion card → speculative generation job (Opus) → Accept → approve → click the
// widget → drafts for the remaining unread email, 0 sent.
//   BACKEND_PORT=8805 LLM_PROVIDER=anthropic DATA_DB_PATH=/tmp/nx-d.db npm run start -w apps/backend
//   BACKEND_URL=http://127.0.0.1:8805 npm run build
//   cd tests/tools && E2E_PORT=8805 PW_PROFILE=/tmp/nx-d-prof RUN=1 npx tsx suggest-live.mjs
// Writes docs/evidence/D/live-suggest-<RUN>.json (trace ids, timings, outcome; no LLM inputs).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchWithExtension, openPanel, G2_URL } from '../e2e/helpers.ts';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const RUN = process.env.RUN ?? String(Date.now());
const OUT = path.resolve(DIR, '../../docs/evidence/D');
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(`[suggest-live ${RUN}]`, ...a);
const msg = (panel, m) => panel.evaluate(`chrome.runtime.sendMessage(${JSON.stringify(m)})`);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const result = { run: RUN, ok: false, phase: 'start', timings: {} };
const t0 = Date.now();
const CARD = '#wwa-suggestion-card';

async function waitFor(fn, timeout, what) {
  const end = Date.now() + timeout;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error(`timeout waiting for ${what}`); await sleep(500); }
}

const { context } = await launchWithExtension();
try {
  const panel = await openPanel(context);
  await msg(panel, { type: 'SET_SETTINGS', patch: { observe: true, suggestions: true } });
  const page = await context.newPage();
  await page.goto(G2_URL);
  await page.waitForSelector('tr.zA');
  const completed = async () => (await msg(panel, { type: 'ACTIVITY_GET' })).state?.recentCompleted?.filter(t => t.status === 'completed').length ?? 0;
  const replies = [['m1', 'Thanks Priya! I will review the checklist and confirm owners for items 3 and 7 by Friday.'], ['m3', 'Thanks for the digest. I will look at the pending approval today.']];
  for (const [i, [id, text]] of replies.entries()) {
    result.phase = `reply ${id}`;
    await page.bringToFront();
    if (!(await page.locator('table[role="grid"]').count())) await page.click('[aria-label="Back to Inbox"]');
    await page.click(`tr[data-legacy-message-id="${id}"]`);
    await page.waitForSelector('.a3s');
    await page.click('[aria-label="Reply"]');
    await page.waitForSelector('[aria-label="Message Body"]');
    await page.keyboard.type(text, { delay: 8 });
    await page.waitForSelector('#toast:not([hidden])', { timeout: 6000 });
    const tDone = Date.now();
    await waitFor(async () => (await completed()) >= i + 1, 90_000, `completed task #${i + 1}`);
    result.timings[`completed${i + 1}`] = Date.now() - tDone;
    if (i === 0) {
      await sleep(1500);
      result.cardAfterFirst = await page.locator(CARD).count();
      log('after 1st reply: card count', result.cardAfterFirst, '·', (await msg(panel, { type: 'ACTIVITY_GET' })).diag?.lastJudge);
    } else {
      result.phase = 'wait card';
      const tc = Date.now();
      const shown = await page.waitForSelector(CARD, { state: 'attached', timeout: 60_000 }).then(() => true, () => false);
      const a = await msg(panel, { type: 'ACTIVITY_GET' });
      result.lastJudge = a.diag?.lastJudge;
      result.patterns = a.state?.patterns?.map(p => `${p.id}(${p.instanceIds.length})`);
      if (!shown) throw new Error(`no suggestion after the 2nd completed reply — ${a.diag?.lastJudge}`);
      result.timings.cardAfterCompletion = result.timings.completed2 + (Date.now() - tc);
      result.suggestion = a.suggestions[0] && { title: a.suggestions[0].title, why: a.suggestions[0].why, score: a.suggestions[0].score, patternId: a.suggestions[0].patternId, jobId: a.suggestions[0].jobId, traceId: a.suggestions[0].traceId };
      log('card:', result.suggestion?.title, '·', result.suggestion?.why);
    }
  }
  result.phase = 'job';
  const tj = Date.now();
  await page.bringToFront();
  await page.locator(`${CARD} button[data-a="accept"]`).click(); // Accept while generating → "Preparing…" → approval card when ready
  await panel.locator('[data-testid="approval-card"] h3').first().waitFor({ timeout: 300_000 });
  result.timings.jobReadyAfterAccept = Date.now() - tj;
  const jobs = (await msg(panel, { type: 'JOBS_LIST' })).jobs;
  result.job = jobs[0] && { id: jobs[0].id, status: jobs[0].status, traceId: jobs[0].traceId, ms: jobs[0].updatedAt - jobs[0].createdAt };
  const w0 = (await msg(panel, { type: 'LIST_WIDGETS' })).widgets[0];
  result.widget = { name: w0.name, approvedBeforeClick: w0.approved, plan: w0.plan, code: w0.code };
  log('approval card:', w0.name, 'approved?', w0.approved);
  result.phase = 'approve+run';
  await panel.bringToFront();
  await panel.locator('[data-testid="approval-card"] [data-testid="approve"]').first().click();
  await page.bringToFront();
  await sleep(2500);
  const btns = page.locator('[id^="wwa-"] button, [id^="wwa-"] >> css=button');
  log('widget buttons on page:', await btns.count());
  // the widget's trigger (whatever the generator named it) — click the first widget-owned button that is not our card
  const clicked = await page.evaluate(`(() => { for (const h of document.querySelectorAll('[id^="wwa-"]')) { if (h.id === 'wwa-suggestion-card' || h.id === 'wwa-rec-pill') continue; const b = (h.shadowRoot || h).querySelector('button'); if (b) { b.click(); return h.id; } } return null; })()`);
  result.triggerHost = clicked;
  const hasM2 = async () => page.evaluate('(window.__drafts||[]).some(d => d.msgId === "m2")');
  const bulk = await waitFor(hasM2, 90_000, 'draft for m2 (bulk trigger)').then(() => true, () => false);
  result.widgetShape = bulk ? 'bulk' : 'per-item';
  if (!bulk) { // per-item widget: open the remaining unread email and use its trigger there
    if (!(await page.locator('table[role="grid"]').count())) await page.click('[aria-label="Back to Inbox"]');
    await page.click('tr[data-legacy-message-id="m2"]');
    await sleep(2500);
    result.triggerHost2 = await page.evaluate(`(() => { for (const h of document.querySelectorAll('[id^="wwa-"]')) { if (h.id === 'wwa-suggestion-card' || h.id === 'wwa-rec-pill') continue; const b = (h.shadowRoot || h).querySelector('button'); if (b) { b.click(); return h.id; } } return null; })()`);
    await waitFor(hasM2, 120_000, 'draft for m2 (per-item trigger)');
  }
  await sleep(3000);
  result.drafts = (await page.evaluate('window.__drafts')).map(d => d.msgId);
  result.sent = (await page.evaluate('window.__sent')).length;
  result.ok = result.cardAfterFirst === 0 && result.drafts.includes('m2') && result.sent === 0;
  result.phase = 'done';
  log(result.ok ? 'PASS' : 'FAIL', 'drafts=', JSON.stringify(result.drafts), 'sent=', result.sent);
} catch (e) {
  result.error = String(e?.message ?? e);
  log('FAIL', result.phase, result.error);
} finally {
  result.timings.total = Date.now() - t0;
  fs.writeFileSync(path.join(OUT, `live-suggest-${RUN}.json`), JSON.stringify(result, null, 1));
  await context.close();
}
