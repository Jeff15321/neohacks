import {
  AssistDecision, AssistNewBranch, ASSIST_LIMITS,
  type AssistCreateRequest, type AssistCreateResponse, type AssistDecideRequest, type AssistDecideResponse,
} from '@app/contracts';
import { reviewBranchCode } from '@app/core/assist';
import type { ModuleDeps } from '../types.js';
import { DECIDE_JSON_SCHEMA, DECIDE_SYSTEM, decideUser } from './prompts/decide.js';
import { decideMock } from './prompts/decide.mock.js';
import { CREATE_JSON_SCHEMA, CREATE_SYSTEM, createUser } from './prompts/create.js';
import { createMock } from './prompts/create.mock.js';
import { ESCALATE_SYSTEM } from './prompts/escalate.js';

const parseJson = (text: string): unknown => {
  const s = text.indexOf('{'); const e = text.lastIndexOf('}');
  if (s < 0 || e < 0) throw new Error('no JSON object in model output');
  return JSON.parse(text.slice(s, e + 1));
};

/** Self-healing runtime agent: decide (fast) → create (inference) → one escalation (generation). */
export function createAssistService({ cfg, callModel }: ModuleDeps) {
  return {
    async decide(body: AssistDecideRequest, traceId: string): Promise<AssistDecideResponse> {
      const res = await callModel({
        stage: 'assist.decide', model: cfg.models.fast, effort: 'low',
        system: DECIDE_SYSTEM, messages: [{ role: 'user', content: decideUser(body) }],
        maxTokens: 1024, jsonSchema: DECIDE_JSON_SCHEMA, timeoutMs: 60_000, traceId, mock: decideMock,
      });
      try {
        const d = AssistDecision.parse(parseJson(res.text));
        res.report(true);
        return { ok: true, decision: { choice: d.choice.slice(0, 80), reason: d.reason.slice(0, 500) } };
      } catch (e) {
        const error = `decide output invalid: ${String((e as Error).message).slice(0, 200)}`;
        res.report(false, error);
        return { ok: false, error };
      }
    },

    /** tier "create" (inference model) or "escalate" (generation model). Validated + statically reviewed; one retry. */
    async create(body: AssistCreateRequest, traceId: string): Promise<AssistCreateResponse> {
      const escalate = body.tier === 'escalate';
      let lastError = '';
      for (let attempt = 1; attempt <= 2; attempt++) {
        const res = await callModel({
          stage: `assist.${body.tier}${attempt > 1 ? '.retry' : ''}`,
          model: escalate ? cfg.models.generation : cfg.models.inference,
          effort: 'medium',
          system: escalate ? ESCALATE_SYSTEM : CREATE_SYSTEM,
          messages: [{ role: 'user', content: createUser(body, attempt > 1 ? lastError : undefined) }],
          maxTokens: escalate ? 24_000 : 12_000, jsonSchema: CREATE_JSON_SCHEMA, stream: escalate,
          timeoutMs: escalate ? 240_000 : 120_000, traceId, mock: createMock,
        });
        let branch: AssistNewBranch;
        try { branch = AssistNewBranch.parse(parseJson(res.text)); }
        catch (e) { lastError = `output invalid: ${String((e as Error).message).slice(0, 200)}`; res.report(false, lastError); continue; }
        if (branch.code.length > ASSIST_LIMITS.BRANCH_CODE_CHARS) { lastError = 'branch code too long'; res.report(false, lastError); continue; }
        const review = reviewBranchCode(branch.code);
        if (!review.safe) { lastError = `safety review rejected the branch: ${review.issues.join('; ')}`; res.report(false, lastError); continue; }
        res.report(true);
        const id = branch.id.replace(/[^\w-]/g, '-').slice(0, 60) || 'agent-branch';
        return { ok: true, branch: { ...branch, id, when: branch.when.slice(0, 300), reason: branch.reason.slice(0, 500) }, review };
      }
      return { ok: false, error: lastError || 'create failed', review: { safe: false, issues: [lastError] } };
    },
  };
}
