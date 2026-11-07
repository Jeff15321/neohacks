import Anthropic from '@anthropic-ai/sdk';
import type { CompleteOptions, LLMProvider } from './provider.js';

export class AnthropicProvider implements LLMProvider {
  name = 'anthropic';
  private client: Anthropic;
  constructor(apiKey: string) { this.client = new Anthropic({ apiKey }); }

  async complete(opts: CompleteOptions): Promise<string> {
    const res = await this.client.messages.create({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 4096,
      temperature: opts.temperature ?? 0.2,
      ...(opts.system ? { system: opts.system } : {}),
      messages: opts.messages.map(m => ({ role: m.role, content: m.content })),
    }, { timeout: opts.timeoutMs ?? 120_000 });
    return res.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');
  }
}
