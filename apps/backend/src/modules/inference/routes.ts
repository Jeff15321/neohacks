import { InferenceRequest, LIMITS } from '@app/contracts';
import { HttpError, parseOr400 } from '../../plugins/index.js';
import type { RegisterModule } from '../types.js';
import { inferenceSystem, inferenceUser } from './prompts/inference.js';
import { inferenceMock } from './prompts/inference.mock.js';

/** Naive per-key token bucket (MVP-scale rate limiting). */
function makeLimiter(rpm: number) {
  const buckets = new Map<string, { tokens: number; ts: number }>();
  return (key: string): boolean => {
    const now = Date.now();
    const b = buckets.get(key) ?? { tokens: rpm, ts: now };
    b.tokens = Math.min(rpm, b.tokens + ((now - b.ts) / 60000) * rpm);
    b.ts = now;
    buckets.set(key, b);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  };
}

export const registerInference: RegisterModule = (app, { cfg, callModel }) => {
  const allow = makeLimiter(LIMITS.INFERENCE_RPM_PER_WIDGET);
  app.post('/api/inference', async (req) => {
    const body = parseOr400(InferenceRequest, req.body, 'POST /api/inference');
    if (body.prompt.length > LIMITS.PROMPT_MAX_CHARS) throw new HttpError(400, `prompt exceeds ${LIMITS.PROMPT_MAX_CHARS} chars`, 'validation');
    const ctxJson = body.context === undefined ? '' : JSON.stringify(body.context);
    if (ctxJson.length > LIMITS.CONTEXT_MAX_CHARS) throw new HttpError(400, `context exceeds ${LIMITS.CONTEXT_MAX_CHARS} chars`, 'validation');
    if (!allow(body.widgetId ?? req.ip)) throw new HttpError(429, 'rate limit exceeded', 'rate_limit');
    const res = await callModel({
      stage: 'inference',
      model: cfg.models.inference,
      effort: 'low',
      system: inferenceSystem(body.instruction),
      messages: [{ role: 'user', content: inferenceUser(body.prompt, ctxJson) }],
      maxTokens: 4096,
      timeoutMs: LIMITS.INFERENCE_TIMEOUT_MS,
      traceId: req.traceId,
      mock: inferenceMock,
    });
    res.report(res.text.trim().length > 0);
    return { ok: true, text: res.text };
  });
};
