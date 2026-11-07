// E10 (doc §9): activity-model latency under fast clicking. Replays a 30-Step burst at a fixed inter-arrival gap
// through a faithful re-implementation of the SW ObserveClient policy (ONE request in flight; Steps arriving
// meanwhile queue and the next request takes all of them, ≤40) against a live backend, and measures queue depth,
// batch sizes, per-call latency and suggestion latency (suggestion response time − arrival of the Step carrying
// the completion evidence). Runs Tier 2 at effort low and medium (eval knob).
//   cd tests/tools && E2E_PORT=8805 [GAP_MS=300] [EFFORTS=low,medium] [OUT=../../docs/evidence/D/e10-burst.json] node e10-burst.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const TRACES = path.resolve(DIR, '../traces');
const BASE = `http://127.0.0.1:${process.env.E2E_PORT ?? 8787}`;
const TOKEN = process.env.EXTENSION_AUTH_TOKEN ?? 'dev-token-change-me';
const GAP = Number(process.env.GAP_MS ?? 300);
const EFFORTS = (process.env.EFFORTS ?? 'low,medium').split(',');

const load = (n) => JSON.parse(fs.readFileSync(path.join(TRACES, `${n}.capture.json`), 'utf8')).steps;
// 30 Steps: two issue→ticket transfers (18) + two bug labels (10) + 2 docs-reading Steps
const burst = [...load('act-issue-to-ticket-x2'), ...load('act-label-bug-x2'), ...load('act-noise-docs-search').slice(0, 2)]
  .map((s, i) => ({ ...s, seq: i + 1, id: `e10_${i + 1}` }));
const isEvidence = (s) => s.effects.liveRegionText.length > 0 || s.effects.mutatingOk;

async function run(effort) {
  const userId = crypto.randomUUID();
  const traceId = `t_e10_${effort}_${Date.now().toString(36)}`;
  const arrivals = new Map();
  const queue = [];
  const calls = [];
  const suggestions = [];
  let inFlight = false;
  const t0 = Date.now();
  let resolveDone;
  const done = new Promise(r => { resolveDone = r; });
  let arrived = 0;
  const pump = async () => {
    if (inFlight) return;
    inFlight = true;
    while (queue.length) {
      const batch = queue.splice(0, 40);
      const depth = batch.length + queue.length;
      const ts = Date.now();
      const r = await fetch(`${BASE}/api/observe/steps`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-extension-token': TOKEN, 'x-user-id': userId, 'x-trace-id': traceId }, body: JSON.stringify({ steps: batch, eval: { effort } }) });
      const j = await r.json();
      const te = Date.now();
      calls.push({ batch: batch.length, queueDepthAtSend: depth, ms: te - ts, seqs: [batch[0].seq, batch.at(-1).seq], judge: j.diag?.judge, tier2Ms: j.diag?.tier2Ms, recon: j.diag?.reconsolidated, judgeMs: j.diag?.judgeMs, completed: (j.ops ?? []).filter(o => o.op === 'complete_task').length });
      for (const s of j.suggestions ?? []) {
        const ev = [...batch].reverse().find(isEvidence);
        suggestions.push({ title: s.title, patternId: s.patternId, latencyFromEvidenceMs: ev ? te - arrivals.get(ev.seq) : null, evidenceSeq: ev?.seq });
      }
    }
    inFlight = false;
    if (arrived === burst.length) resolveDone();
  };
  for (const s of burst) {
    await new Promise(r => setTimeout(r, GAP));
    arrivals.set(s.seq, Date.now());
    queue.push(s);
    arrived++;
    void pump();
  }
  if (!inFlight && !queue.length) resolveDone();
  await done;
  const ms = calls.map(c => c.ms);
  const res = {
    effort, gapMs: GAP, steps: burst.length, traceId, totalMs: Date.now() - t0, calls: calls.length,
    meanBatch: +(burst.length / calls.length).toFixed(2), maxQueueDepth: Math.max(...calls.map(c => c.queueDepthAtSend)),
    callMs: { mean: Math.round(ms.reduce((a, b) => a + b, 0) / ms.length), max: Math.max(...ms) },
    drainMsAfterLastArrival: Date.now() - arrivals.get(burst.length), suggestions, callLog: calls,
  };
  console.log(`[e10] effort=${effort} gap=${GAP}ms: ${burst.length} Steps → ${calls.length} calls (mean batch ${res.meanBatch}, max queue ${res.maxQueueDepth}), call mean ${res.callMs.mean} ms / max ${res.callMs.max} ms, drain ${res.drainMsAfterLastArrival} ms after last Step, suggestions ${suggestions.map(s => `${s.patternId} @${s.latencyFromEvidenceMs} ms`).join(', ') || 'none'} · ${traceId}`);
  return res;
}

const out = [];
for (const e of EFFORTS) out.push(await run(e));
if (process.env.OUT) fs.writeFileSync(path.resolve(process.cwd(), process.env.OUT), JSON.stringify(out, null, 1));
