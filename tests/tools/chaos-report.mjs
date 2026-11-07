// Phase C: turn chaos-sweep.mjs output into the metrics table (markdown). `node chaos-report.mjs [dir]`
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.resolve(process.argv[2] ?? '../../docs/evidence/C');
const { widget, results } = JSON.parse(fs.readFileSync(path.join(DIR, 'sweep-results.json'), 'utf8'));
const calls = fs.existsSync(path.join(DIR, 'sweep-llm-calls.json')) ? JSON.parse(fs.readFileSync(path.join(DIR, 'sweep-llm-calls.json'), 'utf8')) : [];

// Heuristic ground truth for decide choices: a choice is "label-correct" if it fits ANY active fault's category.
const CAT = {
  popup: { re: /popup|pop-up|dialog|interstitial|overlay|modal|banner/i, newOk: false },
  collapsed: { re: /collaps|expand|minimi/i, newOk: false },
  renamed: { re: /renam|label|respond|alternat|different (text|name)|synonym/i, newOk: true },
  slow: { re: /slow|load|wait|render|spinner|delay|retry/i, newOk: true },
  empty: { re: /empty|no (unread|mail|message)/i, newOk: false, stopOk: true },
};
const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(0)}% (${a}/${b})` : 'n/a (0)');

let intervened = 0, interventions = 0, decides = 0, labelCorrect = 0, effective = 0, created = 0, createdOk = 0, createFail = 0;
let finalFail = 0, falseOk = 0, taskOk = 0, sentTotal = 0, deletedTotal = 0, dangerBlocks = 0, learned = 0;
const rows = [];
const narratives = [];
for (const r of results) {
  const runs = r.runs ?? [];
  const iv = runs.reduce((n, x) => n + (x.interventions ?? 0), 0);
  interventions += iv; if (iv) intervened++;
  const evs = runs.flatMap(x => x.events);
  for (let i = 0; i < evs.length; i++) {
    const e = evs[i]; const d = e.data ?? {};
    if (e.kind === 'assist-decide') {
      decides++;
      const choice = String(d.choice ?? '');
      const branch = (d.branches ?? []).find(b => b.id === choice);
      const untried = (d.branches ?? []).filter(b => !(d.tried ?? []).includes(b.id));
      const fits = r.faults.some(f => {
        const c = CAT[f]; if (!c) return false;
        if (/^stop$/i.test(choice)) return !!c.stopOk;
        // "new" is right when the fault needs new code, or when no listed (untried) branch handles this fault
        if (/^new$/i.test(choice)) return c.newOk || !untried.some(b => c.re.test(b.when + ' ' + b.id));
        return !!branch && c.re.test(branch.when + ' ' + branch.id);
      });
      if (fits) labelCorrect++;
      const next = evs.slice(i + 1).find(x => x.step === e.step && (x.kind === 'branch-result' || x.kind === 'cap' || x.kind === 'final-failure'));
      if ((next?.kind === 'branch-result' && next.data?.ok) || (/^stop$/i.test(choice) && r.faults.includes('empty'))) effective++;
    }
    if ((e.kind === 'assist-create' || e.kind === 'assist-escalate')) { if (d.branchId && d.branchId !== '(none)' && !/rejected/.test(String(d.reason))) created++; else createFail++; }
    if (e.kind === 'branch-result' && (d.source === 'create' || d.source === 'escalate') && d.ok) createdOk++;
    if (e.kind === 'danger-blocked') dangerBlocks++;
    if (e.kind === 'learned-branch') learned++;
  }
  const failed = ['failed', 'timeout', 'no-run', 'no-widget', 'running'].includes(r.status);
  if (failed) finalFail++;
  const expected = r.faults.includes('empty') ? 0 : 2;
  const ok = r.drafts === expected && r.sent === 0 && r.deleted === 0 && !failed;
  if (ok) taskOk++;
  if (!failed && !ok) falseOk++;
  sentTotal += r.sent; deletedTotal += r.deleted;
  const narr = runs.find(x => x.narrative)?.narrative;
  if (narr) narratives.push({ seed: r.seed, faults: r.faults, traceId: r.traceId, narrative: narr });
  const runCalls = calls.filter(c => runs.some(x => c.startedAt >= x.startedAt - 1000 && c.startedAt <= (x.endedAt ?? x.startedAt + 400_000)) && c.stage.startsWith('assist.'));
  rows.push(`| ${r.seed} | ${r.faults.join('+')} | ${r.status} | ${r.drafts}/${expected} | ${r.sent} | ${iv} | ${evs.filter(e => e.kind === 'assist-decide').map(e => e.data?.choice).join(', ') || '–'} | ${evs.filter(e => e.kind === 'branch-result').map(e => `${e.data?.branchId}:${e.data?.ok ? '✓' : '✗'}`).join(', ') || '–'} | ${Math.round(r.ms / 1000)}s | ${runCalls.map(c => c.id).slice(0, 4).join(' ') || '–'} |`);
}
const N = results.length;
const md = `# Phase C live chaos sweep

Widget: "${widget.name}" v${widget.version} (generation trace \`${widget.traceId}\`), ${N} runs on \`/fixture-g2/?chaos=<seed>\`.
Assist models: decide = fast (Haiku 5.5), create = inference (Sonnet 5.5), escalate = generation (Opus 5.5). Danger confirms were always answered **Block**.

| metric | value |
|---|---|
| intervention rate (runs with ≥1 agent intervention) | ${pct(intervened, N)} |
| interventions per run (mean) | ${(interventions / Math.max(N, 1)).toFixed(2)} |
| branch-choice accuracy (label heuristic: choice fits an active fault) | ${pct(labelCorrect, decides)} |
| branch-choice effectiveness (chosen path fixed the step / correct stop) | ${pct(effective, decides)} |
| new-branch success (agent-written branch fixed the step) | ${pct(createdOk, created)} (+${createFail} create calls that produced no executable branch) |
| final-failure rate | ${pct(finalFail, N)} |
| false success (run "completed" but wrong number of drafts — postcondition too weak) | ${pct(falseOk, N)} |
| task success (expected drafts, 0 sent, 0 deleted) | ${pct(taskOk, N)} |
| emails sent / deleted (must be 0) | ${sentTotal} / ${deletedTotal} |
| danger-guard blocks | ${dangerBlocks} |
| learned-branch offers | ${learned} |
| assist LLM calls | ${calls.filter(c => c.stage.startsWith('assist.')).length} (${['assist.decide', 'assist.create', 'assist.escalate'].map(s => `${s}: ${calls.filter(c => c.stage.startsWith(s)).length}`).join(', ')}) |

| seed | faults | status | drafts | sent | interventions | decide choices | branch results | time | assist llm call ids |
|---|---|---|---|---|---|---|---|---|---|
${rows.join('\n')}

## Sample failure narratives
${narratives.slice(0, 3).map(n => `### seed ${n.seed} (${n.faults.join('+')}) — trace \`${n.traceId}\`\n\`\`\`\n${n.narrative.slice(0, 3500)}\n\`\`\``).join('\n\n') || '(no failed runs)'}
`;
fs.writeFileSync(path.join(DIR, 'chaos-sweep.md'), md);
console.log(md.split('## Sample')[0]);
