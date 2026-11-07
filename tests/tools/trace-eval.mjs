// Trace-replay eval harness (doc §8 test strategy): replay recorded Step logs (tests/traces/*.capture.json) offline
// into the backend stages — Tier-1 Step Interpreter and Workflow Interpreter — and score them against hand labels
// (tests/traces/*.labels.json). No browser. Works against a mock backend (smoke) or a live one (the real eval).
//   BACKEND_PORT=8802 LLM_PROVIDER=anthropic DATA_DB_PATH=/tmp/nx-b.db npm run start -w apps/backend
//   cd tests/tools && E2E_PORT=8802 [ONLY=gmail2-reply] [STAGES=tier1,spec] [OUT=../../docs/evidence/B/trace-eval.json] node trace-eval.mjs
// Phase D: STAGES=activity replays traces with `labels.activity` into POST /api/observe/steps (Tier1→Tier2→recon→Judge)
//   and scores pattern accuracy (repeat traces), suggestions on noise traces (E4) and latency.
//   [ACT_MODE=step|batch] [ACT_NO_TIER1=1] [ACT_EFFORT=low|medium] [CONCURRENCY=4] [STEP_GAP_MS=0]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const TRACES = path.resolve(DIR, '../traces');
const BASE = process.env.BACKEND_URL ?? `http://127.0.0.1:${process.env.E2E_PORT ?? 8787}`;
const TOKEN = process.env.EXTENSION_AUTH_TOKEN ?? 'dev-token-change-me';
const STAGES = (process.env.STAGES ?? 'tier1,spec').split(',');
const only = process.env.ONLY?.split(',');

async function post(route, body, traceId, userId) {
  const t0 = Date.now();
  const r = await fetch(BASE + route, { method: 'POST', headers: { 'content-type': 'application/json', 'x-extension-token': TOKEN, 'x-trace-id': traceId, ...(userId ? { 'x-user-id': userId } : {}) }, body: JSON.stringify(body) });
  const json = await r.json().catch(() => ({}));
  return { status: r.status, json, ms: Date.now() - t0 };
}
const re = (s) => new RegExp(s, 'i');
const health = await fetch(BASE + '/health').then(r => r.json()).catch(() => null);
if (!health) { console.error(`backend not reachable at ${BASE}`); process.exit(2); }
console.log(`[trace-eval] backend ${BASE} provider=${health.provider}`);

const results = [];
const activityTraces = [];
for (const f of fs.readdirSync(TRACES).filter(f => f.endsWith('.capture.json')).sort()) {
  const name = f.replace('.capture.json', '');
  if (only && !only.includes(name)) continue;
  const trace = JSON.parse(fs.readFileSync(path.join(TRACES, f), 'utf8'));
  const lf = path.join(TRACES, `${name}.labels.json`);
  if (!fs.existsSync(lf)) { console.log(`[trace-eval] ${name}: no labels, skipped`); continue; }
  const labels = JSON.parse(fs.readFileSync(lf, 'utf8'));
  if (labels.activity) activityTraces.push({ name, trace, labels });
  if (!labels.tier1 && !labels.spec) continue; // activity-only trace (Phase D)
  if (!STAGES.includes('tier1') && !STAGES.includes('spec')) continue;
  const res = { name, steps: trace.steps.length, checks: [], ms: {} };
  const check = (id, ok, detail) => res.checks.push({ id, ok: !!ok, detail });
  const traceId = `t_eval_${name.replace(/[^a-z0-9]/gi, '').slice(0, 20)}_${Date.now().toString(36)}`;
  res.traceId = traceId;

  let semantic = [];
  if (STAGES.includes('tier1')) {
    // replay the way the SW does it: one Step per call, with the last 5 labels as context
    const t0 = Date.now();
    for (const s of trace.steps) {
      const r = await post('/api/recordings/steps/interpret', { steps: [s], recent: semantic.slice(-5) }, traceId);
      const sem = r.json.semantic?.[0];
      if (sem) semantic.push({ ...sem, seq: s.seq });
      else check(`tier1#${s.seq}:ok`, false, r.json.error ?? r.status);
    }
    res.ms.tier1 = Date.now() - t0;
    for (const [seq, want] of Object.entries(labels.tier1 ?? {})) {
      const got = semantic.find(x => String(x.seq) === seq);
      const text = got ? `${got.verb} ${got.object}` : '(none)';
      check(`tier1#${seq}`, got && re(want).test(text), `want /${want}/ got "${text}"`);
    }
    for (const seq of labels.navigationOnly ?? []) {
      const got = semantic.find(x => x.seq === seq);
      check(`tier1#${seq}:navOnly`, got?.isNavigationOnly === true, `isNavigationOnly=${got?.isNavigationOnly}`);
    }
  }

  if (STAGES.includes('spec') && labels.spec) {
    const L = labels.spec;
    const r = await post('/api/recordings/interpret', { recordingId: `eval_${name}`, steps: trace.steps, semantic, struck: L.struck, instructions: L.instructions }, traceId);
    res.ms.spec = r.ms;
    const spec = r.json.spec;
    check('spec:ok', r.status === 200 && spec, r.json.error ?? r.status);
    if (spec) {
      res.goal = spec.goal;
      if (L.goal) check('spec:goal', re(L.goal).test(spec.goal), spec.goal);
      if (L.goalNot) check('spec:goalNot', !re(L.goalNot).test(spec.goal), spec.goal);
      if (L.minSlots !== undefined) check('spec:slots', spec.inputs.length >= L.minSlots, spec.inputs.map(i => i.name).join(', '));
      if (L.slot) check('spec:slotName', spec.inputs.some(i => re(L.slot).test(`${i.name} ${i.source}`)), spec.inputs.map(i => i.name).join(', '));
      if (L.consequential) check('spec:consequential', spec.consequentialActions.some(a => re(L.consequential).test(a)), spec.consequentialActions.join('; '));
      const cited = new Set(spec.steps.flatMap(s => s.evidence.stepSeq));
      const essentialCited = new Set(spec.steps.filter(s => s.role === 'essential').flatMap(s => s.evidence.stepSeq));
      for (const seq of L.mustCite ?? []) check(`spec:cites#${seq}`, cited.has(seq), [...cited].join(','));
      for (const seq of L.noise ?? []) check(`spec:noise#${seq}`, !essentialCited.has(seq), `essential cites ${[...essentialCited].join(',')}`);
      if (L.maxQuestions !== undefined) check('spec:questions', spec.openQuestions.length <= L.maxQuestions, `${spec.openQuestions.length} questions`);
    }
  }
  res.passed = res.checks.filter(c => c.ok).length;
  res.total = res.checks.length;
  results.push(res);
  console.log(`[trace-eval] ${name}: ${res.passed}/${res.total} checks · tier1 ${res.ms.tier1 ?? '-'} ms · spec ${res.ms.spec ?? '-'} ms · trace ${traceId}`);
  for (const c of res.checks.filter(c => !c.ok)) console.log(`    ✗ ${c.id} — ${String(c.detail).slice(0, 200)}`);
}

// ------------------------------------------------------------------------------------------------ Phase D: activity
const activity = [];
if (STAGES.includes('activity')) {
  const MODE = process.env.ACT_MODE ?? 'step';
  const evalKnobs = { ...(process.env.ACT_NO_TIER1 === '1' ? { noTier1: true } : {}), ...(process.env.ACT_EFFORT ? { effort: process.env.ACT_EFFORT } : {}) };
  const GAP = Number(process.env.STEP_GAP_MS ?? 0);
  const queue = [...activityTraces];
  const runOne = async ({ name, trace, labels }) => {
    const L = labels.activity;
    const userId = crypto.randomUUID();
    const traceId = `t_act_${name.replace(/[^a-z0-9]/gi, '').slice(0, 18)}_${Date.now().toString(36)}`;
    const batches = MODE === 'batch' ? [trace.steps] : trace.steps.map(s => [s]);
    const calls = [];
    const suggestions = [];
    let state = null;
    const t0 = Date.now();
    for (const b of batches) {
      if (GAP) await new Promise(r => setTimeout(r, GAP));
      const r = await post('/api/observe/steps', { steps: b, ...(Object.keys(evalKnobs).length ? { eval: evalKnobs } : {}) }, traceId, userId);
      if (r.status !== 200) { calls.push({ seqs: b.map(s => s.seq), ms: r.ms, error: r.json.error ?? r.status }); continue; }
      state = r.json.state;
      calls.push({ seqs: b.map(s => s.seq), ms: r.ms, tier1Ms: r.json.diag.tier1Ms, tier2Ms: r.json.diag.tier2Ms, judgeMs: r.json.diag.judgeMs, recon: r.json.diag.reconsolidated, judge: r.json.diag.judge, opErrors: r.json.diag.opErrors.length, ops: r.json.ops.map(o => o.op) });
      for (const s of r.json.suggestions) suggestions.push({ atSeq: b.at(-1).seq, latencyMs: r.ms, title: s.title, patternId: s.patternId, score: s.score });
    }
    const completed = (state?.recentCompleted ?? []).filter(t => t.status === 'completed');
    const pats = (state?.patterns ?? []).map(p => ({ id: p.id, name: p.name, completed: new Set(p.instanceIds).size, text: `${p.id} ${p.name} ${p.abstractSteps.join(' ')}` }));
    const res = { name, kind: L.noise ? 'noise' : 'repeat', traceId, steps: trace.steps.length, ms: Date.now() - t0, completedTasks: completed.length, completedGoals: completed.map(t => t.goal), patterns: pats.map(({ text, ...p }) => p), suggestions, calls };
    if (L.noise) {
      res.ok = suggestions.length === 0;
    } else {
      const best = pats.filter(p => re(L.pattern).test(p.text)).sort((a, b) => b.completed - a.completed)[0];
      res.patternCorrect = !!best && best.completed >= (L.minCompleted ?? 2);
      res.bestPattern = best ? `${best.id} (${best.completed})` : null;
      res.suggested = suggestions.length > 0;
      res.expectSuggestion = L.expectSuggestion;
      res.ok = res.patternCorrect;
    }
    activity.push(res);
    console.log(`[trace-eval] activity ${name}: ${res.kind} ${res.ok ? 'OK' : 'MISS'} · pattern ${res.bestPattern ?? (pats.map(p => `${p.id}(${p.completed})`).join(',') || '-')} · completed ${res.completedTasks} · suggestions ${suggestions.length} · ${(res.ms / 1000).toFixed(1)} s · ${traceId}`);
  };
  const N = Number(process.env.CONCURRENCY ?? 4);
  await Promise.all(Array.from({ length: N }, async () => { while (queue.length) await runOne(queue.shift()); }));
}

const sum = (k) => results.reduce((n, r) => n + r[k], 0);
const tier1 = results.flatMap(r => r.checks.filter(c => c.id.startsWith('tier1#') && !c.id.includes(':')));
const spec = results.flatMap(r => r.checks.filter(c => c.id.startsWith('spec:')));
const summary = {
  backend: BASE, provider: health.provider, at: new Date().toISOString(), traces: results.length,
  checks: `${sum('passed')}/${sum('total')}`,
  tier1Accuracy: tier1.length ? +(tier1.filter(c => c.ok).length / tier1.length).toFixed(3) : null,
  specCheckRate: spec.length ? +(spec.filter(c => c.ok).length / spec.length).toFixed(3) : null,
  results,
};
if (activity.length) {
  const rep = activity.filter(a => a.kind === 'repeat');
  const noise = activity.filter(a => a.kind === 'noise');
  const lat = activity.flatMap(a => a.suggestions.map(s => s.latencyMs));
  const callMs = activity.flatMap(a => a.calls.map(c => c.ms)).sort((a, b) => a - b);
  summary.activity = {
    mode: process.env.ACT_MODE ?? 'step', noTier1: process.env.ACT_NO_TIER1 === '1', effort: process.env.ACT_EFFORT ?? 'low',
    patternAccuracy: `${rep.filter(a => a.patternCorrect).length}/${rep.length}`,
    repeatSuggested: `${rep.filter(a => a.suggested).length}/${rep.length}`,
    expectedSuggestionsHit: `${rep.filter(a => a.expectSuggestion === true && a.suggested).length}/${rep.filter(a => a.expectSuggestion === true).length}`,
    noiseTracesWithSuggestions: `${noise.filter(a => a.suggestions.length).length}/${noise.length}`,
    noiseSuggestions: noise.reduce((n, a) => n + a.suggestions.length, 0),
    meanSuggestionLatencyMs: lat.length ? Math.round(lat.reduce((a, b) => a + b, 0) / lat.length) : null,
    callMs: callMs.length ? { n: callMs.length, mean: Math.round(callMs.reduce((a, b) => a + b, 0) / callMs.length), p50: callMs[Math.floor(callMs.length / 2)], p90: callMs[Math.floor(callMs.length * 0.9)], max: callMs.at(-1) } : null,
    results: activity.sort((a, b) => a.name.localeCompare(b.name)),
  };
  console.log(`[trace-eval] ACTIVITY pattern accuracy ${summary.activity.patternAccuracy} · repeat suggested ${summary.activity.repeatSuggested} · noise traces with suggestions ${summary.activity.noiseTracesWithSuggestions} (${summary.activity.noiseSuggestions} suggestions) · mean suggestion latency ${summary.activity.meanSuggestionLatencyMs} ms · call ms ${JSON.stringify(summary.activity.callMs)}`);
}
console.log(`[trace-eval] SUMMARY checks ${summary.checks} · tier1 accuracy ${summary.tier1Accuracy} · spec checks ${summary.specCheckRate}`);
if (process.env.OUT) fs.writeFileSync(path.resolve(process.cwd(), process.env.OUT), JSON.stringify(summary, null, 1));
