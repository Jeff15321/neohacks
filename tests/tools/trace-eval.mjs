// Trace-replay eval harness (doc §8 test strategy): replay recorded Step logs (tests/traces/*.capture.json) offline
// into the backend stages — Tier-1 Step Interpreter and Workflow Interpreter — and score them against hand labels
// (tests/traces/*.labels.json). No browser. Works against a mock backend (smoke) or a live one (the real eval).
//   BACKEND_PORT=8802 LLM_PROVIDER=anthropic DATA_DB_PATH=/tmp/nx-b.db npm run start -w apps/backend
//   cd tests/tools && E2E_PORT=8802 [ONLY=gmail2-reply] [STAGES=tier1,spec] [OUT=../../docs/evidence/B/trace-eval.json] node trace-eval.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const TRACES = path.resolve(DIR, '../traces');
const BASE = process.env.BACKEND_URL ?? `http://127.0.0.1:${process.env.E2E_PORT ?? 8787}`;
const TOKEN = process.env.EXTENSION_AUTH_TOKEN ?? 'dev-token-change-me';
const STAGES = (process.env.STAGES ?? 'tier1,spec').split(',');
const only = process.env.ONLY?.split(',');

async function post(route, body, traceId) {
  const t0 = Date.now();
  const r = await fetch(BASE + route, { method: 'POST', headers: { 'content-type': 'application/json', 'x-extension-token': TOKEN, 'x-trace-id': traceId }, body: JSON.stringify(body) });
  const json = await r.json().catch(() => ({}));
  return { status: r.status, json, ms: Date.now() - t0 };
}
const re = (s) => new RegExp(s, 'i');
const health = await fetch(BASE + '/health').then(r => r.json()).catch(() => null);
if (!health) { console.error(`backend not reachable at ${BASE}`); process.exit(2); }
console.log(`[trace-eval] backend ${BASE} provider=${health.provider}`);

const results = [];
for (const f of fs.readdirSync(TRACES).filter(f => f.endsWith('.capture.json')).sort()) {
  const name = f.replace('.capture.json', '');
  if (only && !only.includes(name)) continue;
  const trace = JSON.parse(fs.readFileSync(path.join(TRACES, f), 'utf8'));
  const lf = path.join(TRACES, `${name}.labels.json`);
  if (!fs.existsSync(lf)) { console.log(`[trace-eval] ${name}: no labels, skipped`); continue; }
  const labels = JSON.parse(fs.readFileSync(lf, 'utf8'));
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
console.log(`[trace-eval] SUMMARY checks ${summary.checks} · tier1 accuracy ${summary.tier1Accuracy} · spec checks ${summary.specCheckRate}`);
if (process.env.OUT) fs.writeFileSync(path.resolve(process.cwd(), process.env.OUT), JSON.stringify(summary, null, 1));
