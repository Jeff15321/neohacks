/** LLM provider abstraction: swap via LLM_PROVIDER env. */

export interface ChatMessage { role: 'user' | 'assistant'; content: string; }

export interface CompleteOptions {
  system?: string;
  messages: ChatMessage[];
  model: string;
  maxTokens?: number;
  temperature?: number;
  /** Hard timeout for the provider call. */
  timeoutMs?: number;
}

export interface LLMProvider {
  name: string;
  complete(opts: CompleteOptions): Promise<string>;
}
