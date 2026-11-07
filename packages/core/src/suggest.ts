/**
 * §1.5 / §7 suggestion gating + dedupe (owner: Phase D). Pure: no chrome.* / node / fastify imports.
 *
 * Deterministic guard rails around the Tier-3 Judge — the LLM can only make suggestions rarer, never more frequent:
 *  1. only at task boundaries: a `completed` event (with evidence) in THIS batch;
 *  2. Tier 2 must have flagged the task (flag_opportunity);
 *  3. ≥2 COMPLETED instances of the task's pattern, OR 1 with strong mechanical-transfer evidence
 *     (≥3 lineage edges or the same operation over several items);
 *  4. the pattern is not dismissed ("Never for this");
 *  5. at most one visible suggestion, and a per-pattern cooldown (no re-suggest of an already suggested pattern
 *     within the cooldown).
 */
import type { Suggestion, WorkingMemory } from '@app/contracts';
import type { ReduceEvent } from './activity.js';
import { completedInstances, findTask } from './activity.js';

export const SUGGEST_LIMITS = { MIN_INSTANCES: 2, MIN_LINEAGE_EDGES: 3, PATTERN_COOLDOWN_MS: 30 * 60_000 } as const;

export interface SuggestedRecord { patternId: string; at: number }

export interface GateInput {
  memory: WorkingMemory;
  events: ReduceEvent[];
  /** Patterns suggested before (backend snapshot) — cooldown + "one live suggestion per pattern". */
  suggested: SuggestedRecord[];
  /** Lineage edges observed inside a task's steps (mechanical-transfer evidence), by task id. */
  lineageByTask?: Record<string, number>;
  now: number;
}

export interface GateCandidate { taskId: string; patternId: string; instances: number; mechanical: boolean; flagReason: string }
export interface GateResult { candidate?: GateCandidate; reason: string }

/** Decide whether the Judge may run for this batch (and on which completed task). */
export function gateJudge(inp: GateInput): GateResult {
  const completed = inp.events.filter((e): e is Extract<ReduceEvent, { type: 'completed' }> => e.type === 'completed');
  if (!completed.length) return { reason: 'no task boundary (no completed task in this batch)' };
  const flags = new Map(inp.events.filter(e => e.type === 'flag').map(e => [(e as { taskId: string }).taskId, (e as { reason: string }).reason]));
  const reasons: string[] = [];
  for (const ev of completed) {
    const t = findTask(inp.memory, ev.taskId);
    if (!t) continue;
    if (ev.status !== 'completed' || t.status !== 'completed') { reasons.push(`${t.id}: uncertain completion never counts`); continue; }
    const patternId = t.patternId;
    if (!patternId) { reasons.push(`${t.id}: no pattern`); continue; }
    if (!flags.has(t.id)) { reasons.push(`${t.id}: not flagged by Tier 2`); continue; }
    if (inp.memory.dismissed.some(d => d.patternId === patternId)) { reasons.push(`${patternId}: dismissed`); continue; }
    const last = inp.suggested.filter(s => s.patternId === patternId).sort((a, b) => b.at - a.at)[0];
    if (last && inp.now - last.at < SUGGEST_LIMITS.PATTERN_COOLDOWN_MS) { reasons.push(`${patternId}: cooldown`); continue; }
    const instances = completedInstances(inp.memory, patternId);
    const mechanical = (inp.lineageByTask?.[t.id] ?? 0) >= SUGGEST_LIMITS.MIN_LINEAGE_EDGES;
    if (instances < SUGGEST_LIMITS.MIN_INSTANCES && !mechanical) { reasons.push(`${patternId}: ${instances} completed instance(s), no mechanical evidence`); continue; }
    return { candidate: { taskId: t.id, patternId, instances, mechanical, flagReason: flags.get(t.id) ?? '' }, reason: 'eligible' };
  }
  return { reason: reasons.join('; ') || 'no eligible completed task' };
}

/** Judge score (§7): value × confidence × feasibility, each clamped to [0,1]. */
export function judgeScore(v: { value: number; confidence: number; feasibility: number }): number {
  const c = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);
  return +(c(v.value) * c(v.confidence) * c(v.feasibility)).toFixed(3);
}

export const MIN_JUDGE_SCORE = 0.3;

/** Is a suggestion currently visible on the page (counts toward "at most one visible")? */
export const isVisible = (s: Suggestion) => (s.status === 'generating' || s.status === 'ready' || s.status === 'failed') && !s.snoozed;

/**
 * SW-side dedupe when a new candidate arrives: drop it if the pattern is dismissed, already has a live
 * (non-dismissed, non-accepted) suggestion, or another suggestion is visible with a higher score.
 * Returns the suggestions to keep visible (≤1) and whether the candidate is admitted.
 */
export function admitSuggestion(existing: Suggestion[], cand: { patternId: string; score: number }, dismissedPatterns: Set<string>): { admit: boolean; reason: string; replace?: string } {
  if (dismissedPatterns.has(cand.patternId)) return { admit: false, reason: 'pattern dismissed' };
  const live = existing.find(s => s.patternId === cand.patternId && s.status !== 'dismissed' && s.status !== 'accepted');
  if (live) return { admit: false, reason: `pattern already has suggestion ${live.id}` };
  const visible = existing.filter(isVisible);
  if (!visible.length) return { admit: true, reason: 'ok' };
  const top = visible.sort((a, b) => b.score - a.score)[0]!;
  if (cand.score > top.score) return { admit: true, reason: `outranks ${top.id}`, replace: top.id };
  return { admit: false, reason: `another suggestion is visible (${top.id})` };
}

/** Stable hash of a spec/request (job reuse when unchanged, §7). FNV-1a. */
export function specHash(v: unknown): string {
  const s = JSON.stringify(v) ?? '';
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}
