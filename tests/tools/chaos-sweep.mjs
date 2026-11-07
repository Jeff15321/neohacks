// Phase C live chaos sweep: generate ONE widget with the live generator on HardMail (?chaos=none), approve it, then run it
// against N chaos seeds (?chaos=<seed>) with the live assist agent. Writes results JSON + markdown table.
//   backend: BACKEND_PORT=8801 LLM_PROVIDER=anthropic DATA_DB_PATH=/tmp/nx-c.db npm run start -w apps/backend
//   build:   BACKEND_URL=http://127.0.0.1:8801 npm run build
//   run:     E2E_PORT=8801 [RUNS=20] [SEED0=1] [OUT=../../docs/evidence/C] npx tsx chaos-sweep.mjs
import fs from 'node:fs';
import path from 'node:path';
import { launchWithExtension, openPanel, G2_URL, BASE, TOKEN } from '../e2e/helpers.ts';

const RUNS = Number(process.env.RUNS ?? 20);
const SEED0 = Number(process.env.SEED0 ?? 1);
const OUT = path.resolve(process.env.OUT ?? '../../docs/evidence/C');
const RUN_TIMEOUT = Number(process.env.RUN_TIMEOUT ?? 300_000);
const REQUEST = process.env.REQUEST ?? 'Add a toolbar button that reads my two most recent unread emails and writes a friendly AI reply draft for each (save as drafts, never send).';
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const { context, sw } = await launchWithExtension();
const panel = await openPanel(context);
const send = (m) => panel.evaluate(`chrome.runtime.sendMessage(${JSON.stringify(m)})`);
const llmCalls = async (traceId) => (await (await fetch(`${BASE}/api/debug/llm-calls?limit=500${traceId ? `&traceId=${traceId}` : ''}`, { headers: { 'x-extension-token': TOKEN } })).json()).calls ?? [];

// 1) generate once (live generator) on the no-fault chaos page
let page = await context.newPage();
await page.goto(`${G2_URL}?chaos=none`);
await page.waitForSelector('tr.zA');
let widget;
if (process.env.WIDGET_JSON) {
  throw new Error('WIDGET_JSON not supported');
} else {
  log('generating widget (live)…');
  await panel.click('[data-testid="tab-create"]');
  await panel.fill('#req', REQUEST);
  await panel.click('#gen-btn');
  await panel.locator('[data-testid="approval-card"] h3').first().waitFor({ timeout: 660_000 });
  widget = ((await send({ type: 'LIST_WIDGETS' })).widgets ?? [])[0];
  log('generated:', widget.name, 'trace', widget.traceId, 'code chars', widget.code.length, 'uses step:', /WidgetAI\.step\(/.test(widget.code));
  fs.writeFileSync(path.join(OUT, 'sweep-widget.js'), `// ${widget.name} (v${widget.version}) trace ${widget.traceId}\n${widget.code}\n`);
  await panel.click('[data-testid="approval-card"] [data-testid="approve"]');
  await sleep(4000);
}

// 2) sweep
const results = [];
for (let i = 0; i < RUNS; i++) {
  const seed = SEED0 + i;
  await page.close().catch(() => {});
  page = await context.newPage();
  await page.goto(`${G2_URL}?chaos=${seed}`);
  const faults = await page.evaluate(() => window.__chaos.faults);
  const btn = page.locator('[id^="wwa-"]:not([data-testid]) >> css=button').first();
  const res = { seed, faults, status: 'no-widget', drafts: 0, sent: 0, deleted: 0, ms: 0 };
  try {
    await btn.waitFor({ timeout: 20_000 });
    const before = new Set(((await send({ type: 'GET_RUNS', limit: 50 })).runs ?? []).map(r => r.id));
    const t0 = Date.now();
    const logBefore = (await sw.evaluate('globalThis.__wwaBus.log.list()')).length;
    await btn.click({ timeout: 10_000 }).catch(async () => { await btn.dispatchEvent('click'); });
    let run = null;
    for (;;) {
      await sleep(1500);
      const runs = ((await send({ type: 'GET_RUNS', limit: 50 })).runs ?? []).filter(r => !before.has(r.id) && r.startedAt >= t0 - 2000);
      run = runs.sort((a, b) => a.startedAt - b.startedAt)[0] ?? null;
      const allDone = runs.length && runs.every(r => r.status !== 'running');
      const statusMsgs = (await sw.evaluate('globalThis.__wwaBus.log.list()')).slice(logBefore).filter(e => e.type === 'WIDGET_STATUS' && e.channel === 'userScript');
      // a dangerous click awaiting confirmation: always Block in the sweep (never allow consequential actions)
      const confirm = page.locator('[data-testid="wwa-danger-confirm"] [data-testid="danger-block"]');
      if (await confirm.count()) { log('  danger confirm shown → Block'); await confirm.first().click(); }
      if ((allDone && statusMsgs.length) || (!runs.length && statusMsgs.length && Date.now() - t0 > 5000) || (allDone && Date.now() - t0 > 20_000)) break;
      if (Date.now() - t0 > RUN_TIMEOUT) { res.status = 'timeout'; break; }
    }
    res.ms = Date.now() - t0;
    const runs = ((await send({ type: 'GET_RUNS', limit: 50 })).runs ?? []).filter(r => !before.has(r.id) && r.startedAt >= t0 - 2000);
    res.runs = runs;
    const st = await page.evaluate(() => ({ d: window.__drafts.length, s: window.__sent.length, x: window.__deleted.length, ids: window.__drafts.map(d => d.msgId) }));
    Object.assign(res, { drafts: st.d, sent: st.s, deleted: st.x, draftIds: st.ids });
    if (res.status !== 'timeout') res.status = runs.length ? (runs.some(r => r.status === 'failed') ? 'failed' : runs.every(r => r.status === 'completed') ? 'completed' : 'running') : 'no-run';
    res.traceId = runs[0]?.traceId;
  } catch (e) { res.error = String(e?.message ?? e).slice(0, 300); }
  results.push(res);
  const iv = (res.runs ?? []).reduce((n, r) => n + r.interventions, 0);
  log(`seed ${seed} [${faults}] → ${res.status} drafts=${res.drafts} sent=${res.sent} interventions=${iv} ${Math.round(res.ms / 1000)}s`);
  fs.writeFileSync(path.join(OUT, 'sweep-results.json'), JSON.stringify({ widget: { name: widget.name, traceId: widget.traceId, version: widget.version }, results }, null, 2));
}

// 3) LLM calls for attribution (all assist stages since the sweep started)
const calls = (await llmCalls()).filter(c => c.stage.startsWith('assist.') || c.stage.startsWith('generate.'))
  .map(c => ({ id: c.id, traceId: c.traceId, stage: c.stage, model: c.model, latencyMs: c.latencyMs, parseOk: c.parseOk, startedAt: c.startedAt, error: c.error, outputTokens: c.outputTokens }));
fs.writeFileSync(path.join(OUT, 'sweep-llm-calls.json'), JSON.stringify(calls, null, 2));
fs.writeFileSync(path.join(OUT, 'sweep-results.json'), JSON.stringify({ widget: { name: widget.name, traceId: widget.traceId, version: widget.version }, results }, null, 2));
log('done →', OUT);
await context.close();
