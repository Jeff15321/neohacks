import Anthropic from '@anthropic-ai/sdk';
import type { Provider, ProviderRequest, ProviderResponse } from '../types.js';

/**
 * Anthropic provider for current models (Opus/Sonnet/Haiku 5.5):
 * - NO `temperature` (non-default sampling params are rejected with a 400).
 * - Structured outputs via `output_config.format`, effort via `output_config.effort`.
 * - Frozen system prompts get `cache_control` (prompt caching).
 * - Streaming + finalMessage() for long outputs.
 */
export class AnthropicProvider implements Provider {
  name = 'anthropic' as const;
  private client: Anthropic;
  constructor(apiKey: string) { this.client = new Anthropic({ apiKey }); }

  async complete(req: ProviderRequest): Promise<ProviderResponse> {
    const output_config: Anthropic.OutputConfig = {};
    if (req.effort) output_config.effort = req.effort;
    if (req.jsonSchema) output_config.format = { type: 'json_schema', schema: req.jsonSchema };
    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model: req.model,
      max_tokens: req.maxTokens,
      system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
      messages: req.messages.map(m => ({ role: m.role, content: m.content })),
      ...(Object.keys(output_config).length ? { output_config } : {}),
    };
    const opts = { timeout: req.timeoutMs };
    const msg = req.stream
      ? await this.client.messages.stream(params, opts).finalMessage()
      : await this.client.messages.create(params, opts);
    if (msg.stop_reason === 'refusal') throw new Error(`model refused (stage ${req.stage})`);
    const text = msg.content.filter(b => b.type === 'text').map(b => (b as Anthropic.TextBlock).text).join('');
    if (msg.stop_reason === 'max_tokens' && !text) throw new Error(`max_tokens reached with no text (stage ${req.stage})`);
    return {
      text,
      inputTokens: msg.usage?.input_tokens,
      outputTokens: msg.usage?.output_tokens,
      stopReason: msg.stop_reason,
    };
  }
}
