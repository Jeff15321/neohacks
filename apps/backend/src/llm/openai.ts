import type { CompleteOptions, LLMProvider } from './provider.js';

/** Minimal OpenAI provider via fetch — keeps deps light; activate with LLM_PROVIDER=openai. */
export class OpenAIProvider implements LLMProvider {
  name = 'openai';
  constructor(private apiKey: string) {}

  async complete(opts: CompleteOptions): Promise<string> {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), opts.timeoutMs ?? 120_000);
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        signal: ac.signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          model: opts.model,
          temperature: opts.temperature ?? 0.2,
          max_tokens: opts.maxTokens ?? 4096,
          messages: [
            ...(opts.system ? [{ role: 'system', content: opts.system }] : []),
            ...opts.messages,
          ],
        }),
      });
      if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const json = await res.json() as any;
      return json.choices?.[0]?.message?.content ?? '';
    } finally { clearTimeout(t); }
  }
}
