import type { LlmCallLog } from '@app/contracts';
import { randomId } from '@app/core';
import type { Db } from '../store/db.js';
import type { CallModel, CallModelInput, Provider } from './types.js';
import { AnthropicProvider } from './providers/anthropic.js';

const MAX_LOG_CHARS = 200_000;
const clip = (s: string) => (s.length > MAX_LOG_CHARS ? s.slice(0, MAX_LOG_CHARS) + `…[+${s.length - MAX_LOG_CHARS} chars]` : s);

/** Mock provider: runs the per-prompt deterministic mock. */
const mockProvider: Provider = { name: 'mock', complete: async () => { throw new Error('unreachable'); } };

export function makeProvider(cfg: { provider: 'anthropic' | 'mock'; anthropicApiKey?: string }): Provider {
  if (cfg.provider === 'mock') return mockProvider;
  if (!cfg.anthropicApiKey) throw new Error('ANTHROPIC_API_KEY missing (set LLM_PROVIDER=mock for tests)');
  return new AnthropicProvider(cfg.anthropicApiKey);
}

/**
 * THE single entry point for LLM calls (Rules §6). Every call is logged to `llm_calls`
 * (stage, model, effort, latency, tokens, input, output, parse result).
 */
export function createCallModel(provider: Provider, db: Db): CallModel {
  const insert = db.prepare(`INSERT INTO llm_calls (id, trace_id, stage, provider, model, effort, started_at, input)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const finish = db.prepare(`UPDATE llm_calls SET latency_ms = ?, input_tokens = ?, output_tokens = ?, output = ?, error = ? WHERE id = ?`);
  const report = db.prepare(`UPDATE llm_calls SET parse_ok = ?, error = COALESCE(?, error) WHERE id = ?`);

  return async (input: CallModelInput) => {
    const id = randomId('llm', 12);
    const t0 = Date.now();
    const req = {
      stage: input.stage,
      model: input.model,
      effort: input.effort,
      system: input.system,
      messages: input.messages,
      maxTokens: input.maxTokens ?? 4096,
      jsonSchema: input.jsonSchema,
      stream: input.stream ?? false,
      timeoutMs: input.timeoutMs ?? 120_000,
    };
    insert.run(id, input.traceId ?? null, input.stage, provider.name, input.model, input.effort ?? null, t0,
      clip(JSON.stringify({ system: input.system, messages: input.messages })));
    try {
      const res = provider.name === 'mock'
        ? { text: input.mock(req) }
        : await provider.complete(req);
      const r = res as { text: string; inputTokens?: number; outputTokens?: number };
      finish.run(Date.now() - t0, r.inputTokens ?? null, r.outputTokens ?? null, clip(r.text), null, id);
      return {
        text: r.text,
        callId: id,
        report: (ok: boolean, error?: string) => { report.run(ok ? 1 : 0, error ?? null, id); },
      };
    } catch (e) {
      finish.run(Date.now() - t0, null, null, null, String((e as Error)?.message ?? e).slice(0, 2000), id);
      throw e;
    }
  };
}

type Row = Record<string, string | number | null>;
const toLog = (r: Row): LlmCallLog => ({
  id: String(r.id), traceId: (r.trace_id as string) ?? null, stage: String(r.stage), provider: String(r.provider),
  model: String(r.model), effort: (r.effort as string) ?? null, startedAt: Number(r.started_at),
  latencyMs: (r.latency_ms as number) ?? null, inputTokens: (r.input_tokens as number) ?? null,
  outputTokens: (r.output_tokens as number) ?? null, input: String(r.input), output: (r.output as string) ?? null,
  parseOk: r.parse_ok === null || r.parse_ok === undefined ? null : r.parse_ok === 1, error: (r.error as string) ?? null,
});

export function listLlmCalls(db: Db, q: { traceId?: string; limit?: number }): LlmCallLog[] {
  const limit = Math.min(Math.max(q.limit ?? 50, 1), 500);
  const rows = (q.traceId
    ? db.prepare('SELECT * FROM llm_calls WHERE trace_id = ? ORDER BY started_at DESC LIMIT ?').all(q.traceId, limit)
    : db.prepare('SELECT * FROM llm_calls ORDER BY started_at DESC LIMIT ?').all(limit)) as Row[];
  return rows.map(toLog);
}
