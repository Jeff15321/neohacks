/**
 * Decision B (self-healing runtime) pure logic: the recovery ladder + caps, static safety review of agent-written
 * branches, and the final-failure narrative. No chrome.* / node / fastify imports.
 */
import { ASSIST_LIMITS, type AssistDecision, type StepFailureReport, type WidgetRun } from '@app/contracts';
import { checkGeneratedCode } from './validate-code.js';
import { DANGER_TEXT_RE } from './danger.js';

export interface StepAssistState { attempts: number; tried: string[]; newCount: number; lastNew?: { code: string; error: string } }
export interface RunAssistState { interventions: number; startedAt: number; steps: Record<string, StepAssistState> }

export const newRunAssistState = (now: number): RunAssistState => ({ interventions: 0, startedAt: now, steps: {} });

export type AssistPlan =
  | { kind: 'stop'; reason: string }
  | { kind: 'decide' }
  | { kind: 'escalate' };

/**
 * What to do for the next recovery attempt of `step` (caps first). Ladder per step:
 *   decide (fast model) → pre-generated branch | new branch (inference model)
 *   after a failed new branch → one escalation (generation model) → stop.
 */
export function planAssist(run: RunAssistState, step: string, now: number, limits = ASSIST_LIMITS): AssistPlan {
  const s = run.steps[step] ?? { attempts: 0, tried: [], newCount: 0 };
  if (run.interventions >= limits.MAX_INTERVENTIONS_PER_RUN) return { kind: 'stop', reason: `cap: ${limits.MAX_INTERVENTIONS_PER_RUN} agent interventions per run reached` };
  if (now - run.startedAt > limits.RUN_TIMEOUT_MS) return { kind: 'stop', reason: `cap: run exceeded ${Math.round(limits.RUN_TIMEOUT_MS / 1000)} s` };
  if (s.attempts >= limits.MAX_ATTEMPTS_PER_STEP) return { kind: 'stop', reason: `cap: ${limits.MAX_ATTEMPTS_PER_STEP} recovery attempts for step "${step}" used` };
  if (s.newCount >= 2) return { kind: 'stop', reason: 'escalation already used for this step' };
  if (s.newCount >= 1) return { kind: 'escalate' };
  return { kind: 'decide' };
}

/** Record that an attempt is being made (counts toward both caps). */
export function beginAttempt(run: RunAssistState, step: string): StepAssistState {
  const s = (run.steps[step] ??= { attempts: 0, tried: [], newCount: 0 });
  s.attempts++;
  run.interventions++;
  return s;
}

export type ResolvedDecision = { kind: 'branch'; branchId: string } | { kind: 'new' } | { kind: 'stop'; reason: string };

/** Map the decide model's free-form choice onto an action. Unknown / already-tried branch ids become "new". */
export function resolveDecision(d: AssistDecision, report: Pick<StepFailureReport, 'branches' | 'tried' | 'multiOutcome'>): ResolvedDecision {
  const c = d.choice.trim();
  if (/^stop$/i.test(c)) return { kind: 'stop', reason: d.reason || 'agent chose to stop' };
  if (/^new$/i.test(c)) return { kind: 'new' };
  if (report.multiOutcome && /^primary$/i.test(c) && !report.tried.includes('primary')) return { kind: 'branch', branchId: 'primary' };
  const b = report.branches.find(x => x.id === c || x.id.toLowerCase() === c.toLowerCase());
  if (b && !report.tried.includes(b.id)) return { kind: 'branch', branchId: b.id };
  return { kind: 'new' };
}

/** Constructs an agent-written branch must not use (on top of checkGeneratedCode's denylist). */
const BRANCH_BANNED: Array<[RegExp, string]> = [
  [/\.submit\s*\(/, 'calls form.submit() (bypasses the danger guard)'],
  [/requestSubmit\s*\(/, 'calls requestSubmit()'],
  [/\bWidgetAI\b/, 'uses WidgetAI (branches get only (state, h))'],
  [/\b__(request|send|api|need|WID|GRANTS|TRACE)\b/, 'touches prelude internals'],
  [/\bisTrusted\b/, 'references isTrusted'],
  [/\b(localStorage|sessionStorage|indexedDB)\b/, 'touches site storage'],
  [/\b(window\.)?open\s*\(/, 'opens windows'],
  [/\blocation\s*(\.href\s*)?=(?!=)/, 'navigates the page'],
  [/\bimport\s*\(/, 'dynamic import'],
];

/** Quick static safety review of an agent-written branch (runs before it is ever executed). */
export function reviewBranchCode(code: string): { safe: boolean; issues: string[] } {
  const issues: string[] = [];
  const base = checkGeneratedCode(code, { maxChars: ASSIST_LIMITS.BRANCH_CODE_CHARS });
  if (!base.ok) issues.push(base.error);
  for (const [re, why] of BRANCH_BANNED) if (re.test(code)) issues.push(why);
  // string / regex literals naming consequential controls ("Send", /delete/i…) — a branch must never target them
  const literals = code.match(/(['"`])(?:\\.|(?!\1).){1,60}\1|\/(?:\\.|[^/\n]){1,60}\/[gimsuy]*/g) ?? [];
  for (const lit of literals) {
    const inner = lit.replace(/^['"`/]|['"`]$|\/[gimsuy]*$/g, '');
    if (/^\s*$/.test(inner) || inner.length > 40) continue;
    const m = inner.match(DANGER_TEXT_RE);
    if (m) { issues.push(`targets a consequential control (${JSON.stringify(m[0])})`); break; }
  }
  return { safe: issues.length === 0, issues };
}

const fmtTime = (base: number, ts: number) => `+${((ts - base) / 1000).toFixed(1)}s`;
const s = (v: unknown, n = 400) => { const t = typeof v === 'string' ? v : JSON.stringify(v); return t && t.length > n ? t.slice(0, n) + '…' : (t ?? ''); };

/**
 * Exact narrative of a run: every step, postcondition result, branch tried, agent decision + reason, DOM evidence,
 * and why it broke. Shown in the widget, the panel and (via the bus/timeline) the Inspector.
 */
export function buildRunNarrative(run: Pick<WidgetRun, 'events' | 'startedAt' | 'status' | 'widgetName'>, stopReason?: string): string {
  const out: string[] = [];
  const t0 = run.startedAt;
  const start = run.events.find(e => e.kind === 'run-start');
  out.push(`Run of "${run.widgetName ?? 'widget'}"${start?.detail ? ` — goal: ${start.detail}` : ''}`);
  let lastEvidence = '';
  let failedStep = '';
  let lastExpected = '';
  let lastObserved = '';
  let lastDiagnosis = '';
  for (const e of run.events) {
    const d = (e.data ?? {}) as Record<string, unknown>;
    const at = fmtTime(t0, e.ts);
    switch (e.kind) {
      case 'step-start': out.push(`${at} Step "${e.step}" started${e.detail ? ` (${e.detail})` : ''}.`); break;
      case 'step-ok': out.push(`${at}   ✓ "${e.step}" postcondition met${e.detail ? `: ${e.detail}` : ''}.`); break;
      case 'recheck-ok': out.push(`${at}   ✓ re-check: "${e.step}" postcondition already met — not re-acting.`); break;
      case 'expect-fail':
        failedStep = e.step ?? failedStep;
        lastExpected = s(d.expected, 200); lastObserved = s(d.observed, 300);
        out.push(`${at}   ✗ "${e.step}" expected ${s(d.expected, 200)} but observed ${s(d.observed, 300)}${d.error ? ` (error: ${s(d.error, 200)})` : ''}.`);
        if (d.dom) lastEvidence = s(d.dom, 900);
        break;
      case 'assist-decide': lastDiagnosis = s(d.reason, 300); out.push(`${at}   agent (decide, ${s(d.model ?? 'fast model', 40)}) chose "${s(d.choice, 60)}": ${s(d.reason, 300)}`); break;
      case 'assist-create': lastDiagnosis = s(d.reason, 300); out.push(`${at}   agent (create, ${s(d.model ?? 'inference model', 40)}) wrote new branch "${s(d.branchId, 60)}" (${s(d.when, 120)}): ${s(d.reason, 200)}`); break;
      case 'assist-escalate': lastDiagnosis = s(d.reason, 300); out.push(`${at}   agent (escalate, ${s(d.model ?? 'generation model', 40)}) wrote branch "${s(d.branchId, 60)}": ${s(d.reason, 200)}`); break;
      case 'branch-run': out.push(`${at}   running branch "${s(d.branchId, 60)}" (${s(d.source, 20)})${e.detail ? ` — ${e.detail}` : ''}.`); break;
      case 'branch-result': out.push(`${at}   branch "${s(d.branchId, 60)}" ${d.ok ? 'fixed the step' : `did not fix it: ${s(d.observed ?? d.error, 300)}`}.`); break;
      case 'danger-blocked': out.push(`${at}   ⛔ danger guard blocked a script ${s(d.what ?? 'action', 30)} on ${s(d.label, 80)}: ${s(d.reason, 200)}`); break;
      case 'danger-allowed': out.push(`${at}   danger guard: user allowed ${s(d.label, 80)}.`); break;
      case 'cap': out.push(`${at}   stopped: ${e.detail}`); break;
      case 'final-failure': out.push(`${at} FAILED at "${e.step ?? failedStep}": ${e.detail ?? ''}`); break;
      case 'completed': out.push(`${at} Completed${e.detail ? `: ${e.detail}` : ''}.`); break;
      case 'learned-branch': out.push(`${at}   new branch "${s(d.branchId, 60)}" for "${e.step}" can be added to the widget.`); break;
      default: break;
    }
  }
  if (run.status === 'failed') {
    const why = failedStep && lastExpected
      ? `step "${failedStep}" never reached its postcondition (${lastExpected}); last observed: ${lastObserved}.`
      : 'the run did not complete.';
    out.push(`Why it broke: ${why}${lastDiagnosis ? ` Agent's last diagnosis: ${lastDiagnosis}.` : ''} Stopped because: ${stopReason ?? 'the allowed recovery attempts were used up'}.`);
    if (lastEvidence) out.push(`DOM evidence (last observed, untrusted page content):\n${lastEvidence}`);
  }
  return out.join('\n');
}

/** The exact code prepended to the widget for a learned branch (this is the diff shown to the user). */
export function learnedBranchSnippet(step: string, l: { id: string; when: string; code: string }): string {
  const body = l.code.split('\n').map(x => '    ' + x).join('\n');
  return `// Learned branch (added by the self-healing runtime after the agent fixed step ${JSON.stringify(step)}).
WidgetAI.addBranch(${JSON.stringify(step)}, {
  id: ${JSON.stringify(l.id)},
  when: ${JSON.stringify(l.when)},
  run: async (state, h) => {
${body}
  },
});`;
}
