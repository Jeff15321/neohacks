import type { LLMProvider } from './provider.js';
import { AnthropicProvider } from './anthropic.js';
import { OpenAIProvider } from './openai.js';
import { MockProvider } from './mock.js';
import type { Config } from '../config.js';

export function makeProvider(cfg: Config): LLMProvider {
  switch (cfg.provider) {
    case 'mock': return new MockProvider();
    case 'openai':
      if (!cfg.openaiApiKey) throw new Error('OPENAI_API_KEY missing');
      return new OpenAIProvider(cfg.openaiApiKey);
    case 'anthropic':
    default:
      if (!cfg.anthropicApiKey) throw new Error('ANTHROPIC_API_KEY missing');
      return new AnthropicProvider(cfg.anthropicApiKey);
  }
}
export type { LLMProvider, CompleteOptions } from './provider.js';
