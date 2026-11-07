import type { GenerateWidgetRequest, GenerateWidgetResponse } from '@app/contracts';
import { LIMITS } from '@app/contracts';
import type { ModuleDeps } from '../types.js';
import { WIDGET_JSON_SCHEMA, buildWidgetUserPrompt, widgetSystemPrompt } from './prompts/widget.js';
import { widgetMock } from './prompts/widget.mock.js';
import { parseGeneratedWidget } from './validate.js';

const MAX_ATTEMPTS = 2; // initial + one retry with the validator error

export function createGenerateService({ cfg, callModel }: ModuleDeps) {
  return {
    async generateWidget(body: GenerateWidgetRequest, traceId: string): Promise<GenerateWidgetResponse> {
      let lastError = 'unknown';
      let lastCode = '';
      const warnings: string[] = [];
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const effective: GenerateWidgetRequest = attempt === 1 ? body : {
          ...body,
          prior: { code: lastCode.slice(0, 30_000), error: `Validation failed: ${lastError}. Fix the code and return the corrected JSON.`, feedback: body.prior?.feedback },
        };
        const res = await callModel({
          stage: attempt === 1 ? 'generate.widget' : 'generate.widget.retry',
          model: cfg.models.generation,
          effort: 'high',
          system: widgetSystemPrompt(),
          messages: [{ role: 'user', content: buildWidgetUserPrompt(effective) }],
          maxTokens: 32_000,
          jsonSchema: WIDGET_JSON_SCHEMA,
          stream: true,
          timeoutMs: LIMITS.GENERATION_TIMEOUT_MS,
          traceId,
          mock: widgetMock,
        });
        const parsed = parseGeneratedWidget(res.text);
        res.report(!!parsed.widget, parsed.error);
        warnings.push(...parsed.warnings.map(w => `attempt ${attempt}: ${w}`));
        if (parsed.widget) return { ok: true, widget: parsed.widget, warnings, traceId };
        lastError = parsed.error ?? 'parse failed';
        try { lastCode = JSON.parse(res.text.slice(res.text.indexOf('{'), res.text.lastIndexOf('}') + 1)).code ?? res.text; }
        catch { lastCode = res.text; }
      }
      return { ok: false, error: `generation failed after ${MAX_ATTEMPTS} attempts: ${lastError}`, warnings, traceId };
    },
  };
}
