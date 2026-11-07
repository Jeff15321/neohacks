import {
  SemanticStep, WorkflowSpec, z,
  type InterpretRecordingRequest, type InterpretRecordingResponse, type InterpretStepsRequest, type InterpretStepsResponse, type Step,
} from '@app/contracts';
import { randomId } from '@app/core';
import type { ModuleDeps } from '../types.js';
import { STEP_INTERPRET_SCHEMA, STEP_INTERPRET_SYSTEM, stepInterpretUser } from './prompts/step-interpret.js';
import { stepInterpretMock } from './prompts/step-interpret.mock.js';
import { WORKFLOW_INTERPRET_SCHEMA, WORKFLOW_INTERPRET_SYSTEM, workflowInterpretUser } from './prompts/workflow-interpret.js';
import { workflowInterpretMock } from './prompts/workflow-interpret.mock.js';

/** Extract the first JSON object from model text (structured outputs return pure JSON; mocks/fallbacks may not). */
export function extractJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  return JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
}

const Tier1Out = z.object({
  steps: z.array(z.object({
    seq: z.number(), verb: z.string(), object: z.string(),
    entities: z.array(z.object({ key: z.string(), value: z.string() })),
    isNavigationOnly: z.boolean(), readsData: z.array(z.string()), writesData: z.array(z.string()),
  })),
});

/** LLM-shaped spec: evidence without locators/skeletons (the service enriches those from the real Steps). */
const SpecOut = WorkflowSpec.extend({
  steps: z.array(z.object({
    intent: z.string(), site: z.string(), role: z.enum(['essential', 'conditional', 'optional']),
    evidence: z.object({ stepSeq: z.array(z.number()), netOpIds: z.array(z.string()).optional() }),
  })),
  dataFlow: z.array(z.object({ fromSeq: z.number(), toSeq: z.number(), field: z.string().optional(), valueHash: z.string() })),
});

/** Attach the strongest evidence from the cited Steps: their locator bundles and the first appeared-region skeleton. */
export function enrichSpec(spec: z.infer<typeof SpecOut>, steps: Step[], struck: number[] = []): WorkflowSpec {
  const bySeq = new Map(steps.map(s => [s.seq, s]));
  const struckSet = new Set(struck);
  return WorkflowSpec.parse({
    ...spec,
    steps: spec.steps.map(st => {
      const cited = st.evidence.stepSeq.filter(n => bySeq.has(n) && !struckSet.has(n));
      const src = cited.map(n => bySeq.get(n)!);
      const locators = src.flatMap(s => (s.action.target ? [{ ...s.action.target, candidates: s.action.target.candidates.slice(0, 4) }] : []));
      const region = src.flatMap(s => s.effects.addedRegions)[0]?.skeleton;
      return {
        ...st,
        evidence: { stepSeq: cited, netOpIds: st.evidence.netOpIds ?? [], ...(locators.length ? { locators } : {}), ...(region ? { regionSkeleton: region.slice(0, 1500) } : {}) },
      };
    }),
    dataFlow: spec.dataFlow.map(e => ({ ...e, field: e.field || undefined })),
  });
}

export function createRecordingsService({ cfg, db, callModel }: ModuleDeps) {
  const saveTrace = db.prepare('INSERT OR REPLACE INTO traces (id, user_id, kind, created_at, body) VALUES (?, ?, ?, ?, ?)');

  return {
    async interpretSteps(req: InterpretStepsRequest, traceId: string): Promise<InterpretStepsResponse> {
      const res = await callModel({
        stage: 'steps.interpret',
        model: cfg.models.fast,
        effort: 'low',
        system: STEP_INTERPRET_SYSTEM,
        messages: [{ role: 'user', content: stepInterpretUser(req) }],
        maxTokens: 2048,
        jsonSchema: STEP_INTERPRET_SCHEMA,
        timeoutMs: 30_000,
        traceId,
        mock: stepInterpretMock,
      });
      try {
        const out = Tier1Out.parse(extractJson(res.text));
        const semantic = out.steps.map(s => SemanticStep.parse({ ...s, entities: Object.fromEntries(s.entities.map(e => [e.key, e.value])) }));
        res.report(true);
        return { ok: true, semantic };
      } catch (e) {
        const error = `[LLM→recordings] invalid steps.interpret output: ${String((e as Error)?.message ?? e).slice(0, 300)}`;
        res.report(false, error);
        return { ok: false, semantic: [], error };
      }
    },

    async interpretRecording(req: InterpretRecordingRequest, traceId: string, userId?: string): Promise<InterpretRecordingResponse> {
      const res = await callModel({
        stage: 'recordings.interpret',
        model: cfg.models.generation,
        effort: 'high',
        system: WORKFLOW_INTERPRET_SYSTEM,
        messages: [{ role: 'user', content: workflowInterpretUser(req) }],
        maxTokens: 16_000,
        jsonSchema: WORKFLOW_INTERPRET_SCHEMA,
        stream: true,
        timeoutMs: 240_000,
        traceId,
        mock: workflowInterpretMock,
      });
      let spec: WorkflowSpec;
      try {
        spec = enrichSpec(SpecOut.parse(extractJson(res.text)), req.steps, req.struck);
        res.report(true);
      } catch (e) {
        const error = `[LLM→recordings] invalid recordings.interpret output: ${String((e as Error)?.message ?? e).slice(0, 300)}`;
        res.report(false, error);
        return { ok: false, error, traceId };
      }
      // traces table (owned by this module): the recording + its interpretation, for trace export/eval.
      try {
        saveTrace.run(req.recordingId || randomId('rec'), userId ?? null, 'recording', Date.now(), JSON.stringify({ request: req, spec, traceId }).slice(0, 2_000_000));
      } catch { /* trace persistence is best-effort */ }
      return { ok: true, spec, traceId };
    },
  };
}
