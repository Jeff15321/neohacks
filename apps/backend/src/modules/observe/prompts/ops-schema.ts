/**
 * JSON schema of the patch-op list the activity model (Tier 2) and reconsolidation return (structured outputs).
 * LLM-facing op shapes are flat and fully required; the service maps them to contracts `PatchOp`.
 */
const str = { type: 'string' } as const;
const num = { type: 'number' } as const;
const obj = (op: string, props: Record<string, unknown>) => ({
  type: 'object', additionalProperties: false, required: ['op', ...Object.keys(props)],
  properties: { op: { type: 'string', enum: [op] }, ...props },
});
const stepRefs = { type: 'array', items: { type: 'object', additionalProperties: false, required: ['seq', 'role'], properties: { seq: { type: 'integer' }, role: { type: 'string', enum: ['essential', 'enabling', 'optional', 'noise'] } } } };

export const OPS_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['ops'],
  properties: {
    ops: {
      type: 'array',
      items: {
        anyOf: [
          obj('open_task', { taskId: str, goal: str, confidence: num, sites: { type: 'array', items: str }, expectedNext: str }),
          obj('attach_steps', { taskId: str, steps: stepRefs, confidence: num, expectedNext: str, goal: str }),
          obj('fork_hypothesis', { taskId: str, goal: str }),
          obj('merge_hypotheses', { keepId: str, dropId: str }),
          obj('set_slot', { taskId: str, name: str, value: str, provenance: str }),
          obj('complete_task', { taskId: str, evidence: str }),
          obj('abandon_task', { taskId: str, reason: str }),
          obj('link_pattern', { taskId: str, patternId: str }),
          obj('create_pattern', {
            patternId: str, name: str, abstractSteps: { type: 'array', items: str },
            parameters: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'io', 'source'], properties: { name: str, io: { type: 'string', enum: ['input', 'output'] }, source: str } } },
            automationIdea: str,
          }),
          obj('flag_opportunity', { taskId: str, reason: str }),
        ],
      },
    },
  },
};

/** Shared op semantics paragraph (used by the activity and reconsolidation prompts). */
export const OPS_DOC = `PATCH OPS (return {"ops":[...]}, applied in order; ids you reference must exist or be created earlier in the list):
- open_task {taskId, goal, confidence 0-1, sites, expectedNext}: a new task instance. taskId = "t" + the seq of its first step (e.g. "t14"). At most 3 tasks stay active (the lowest-confidence one is dropped).
- attach_steps {taskId, steps:[{seq, role}], confidence, expectedNext, goal}: attach steps to an ACTIVE task. role: essential (part of the goal), enabling (only revealed the next affordance, e.g. expand/open composer), optional, noise (unrelated). goal "" = unchanged; expectedNext = your falsifiable prediction of the next step ("" if none).
- fork_hypothesis {taskId, goal}: record an alternative reading of an ambiguous task (≤2 kept).
- merge_hypotheses {keepId, dropId}: two active tasks are really one.
- set_slot {taskId, name, value, provenance}: a parameter of the task (e.g. thread, recipient, replyText). provenance: "page" (read from the page), "user-authored" (typed by the user — AI could write it), "copied" (lineage).
- complete_task {taskId, evidence}: ONLY with completion evidence = a durable effect visible in the steps: live text like "Draft saved"/"Sent"/"Created"/"Saved", a mutating network call that succeeded (POST/PUT/PATCH/DELETE → 2xx), a route to the newly created resource, a finished download. Quote the evidence. Never complete on navigation alone.
- abandon_task {taskId, reason}: the user clearly moved on without a durable effect (e.g. read an email and went back without acting). Reading/browsing tasks end this way.
- create_pattern {patternId, name, abstractSteps, parameters[{name, io, source}], automationIdea}: a recurring TASK TYPE identified by goal + slot structure, never by exact clicks. patternId = "p_" + snake_case name (e.g. "p_reply_to_email").
- link_pattern {taskId, patternId}: the task is an instance of an existing (or just created) pattern. Link EVERY goal-directed task that ends in a durable effect, including the first instance — repetition is only visible if the first instance is linked too. Reuse an existing pattern whenever the goal + slots match, even if the clicks differ (keyboard vs button, an extra expand step).
- flag_opportunity {taskId, reason}: ONLY right after complete_task, when that task's pattern now has ≥2 completed instances (count the pattern's instanceIds in WORKING MEMORY + this one), or when a single completed instance is obviously mechanical (≥3 values copied from one place into another, or the same operation over several items). Never flag reading, browsing, searching or one-off tasks.`;
