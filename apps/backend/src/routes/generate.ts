import type { FastifyInstance } from 'fastify';
import type { GenerateWidgetRequest, GenerateWidgetResponse } from '@app/shared';
import { LIMITS } from '@app/shared';
import { WIDGET_SYSTEM_PROMPT, buildGenerationUserPrompt } from '../generation/prompt.js';
import { parseGeneratedWidget } from '../generation/parse.js';
import type { LLMProvider } from '../llm/index.js';
import type { Config } from '../config.js';

const MAX_ATTEMPTS = 2; // initial + one retry with feedback

export function registerGenerateRoutes(app: FastifyInstance, llm: LLMProvider, cfg: Config) {
  app.post<{ Body: GenerateWidgetRequest }>('/api/generate-widget', async (req, reply) => {
    const body = req.body;
    if (!body?.request || !body.pageContext) {
      reply.code(400);
      return { ok: false, error: 'missing request or pageContext', warnings: [] } satisfies GenerateWidgetResponse;
    }
    if (body.request.length > 4000) {
      reply.code(400);
      return { ok: false, error: 'request too long', warnings: [] } satisfies GenerateWidgetResponse;
    }

    let lastError = 'unknown';
    let lastCode = '';
    const warnings: string[] = [];
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const effective: GenerateWidgetRequest = attempt === 1 ? body : {
        ...body,
        prior: { code: lastCode.slice(0, 30_000), error: `Validation failed: ${lastError}. Fix the code and return the corrected JSON.` },
      };
      const raw = await llm.complete({
        system: WIDGET_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: buildGenerationUserPrompt(effective) }],
        model: cfg.generationModel,
        maxTokens: 8192,
        temperature: 0.2,
        timeoutMs: LIMITS.GENERATION_TIMEOUT_MS,
      });
      const parsed = parseGeneratedWidget(raw);
      warnings.push(...parsed.warnings.map(w => `attempt ${attempt}: ${w}`));
      if (parsed.widget) {
        return { ok: true, widget: parsed.widget, warnings } satisfies GenerateWidgetResponse;
      }
      lastError = parsed.error ?? 'parse failed';
      try { lastCode = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)).code ?? raw.slice(0, 30_000); }
      catch { lastCode = raw.slice(0, 30_000); }
      req.log.warn({ attempt, lastError }, 'widget generation attempt failed');
    }
    reply.code(422);
    return { ok: false, error: `generation failed after ${MAX_ATTEMPTS} attempts: ${lastError}`, warnings } satisfies GenerateWidgetResponse;
  });
}
