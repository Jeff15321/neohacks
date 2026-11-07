import type { Effort } from '@app/contracts';

export interface ChatMessage { role: 'user' | 'assistant'; content: string; }

/** What a provider receives (already stage-resolved by callModel). */
export interface ProviderRequest {
  stage: string;
  model: string;
  effort?: Effort;
  system: string;
  messages: ChatMessage[];
  maxTokens: number;
  /** JSON schema → `output_config.format` (structured outputs). */
  jsonSchema?: Record<string, unknown>;
  stream: boolean;
  timeoutMs: number;
}

export interface ProviderResponse {
  text: string;
  inputTokens?: number;
  outputTokens?: number;
  stopReason?: string | null;
}

export interface Provider {
  name: 'anthropic' | 'mock';
  complete(req: ProviderRequest): Promise<ProviderResponse>;
}

/** Deterministic mock for one prompt (each prompt file exports one). */
export type MockFn = (req: ProviderRequest) => string;

export interface CallModelInput {
  /** Named pipeline stage, e.g. "generate.widget", "inference". Logged and used for debugging. */
  stage: string;
  model: string;
  effort?: Effort;
  system: string;
  messages: ChatMessage[];
  maxTokens?: number;
  jsonSchema?: Record<string, unknown>;
  /** Stream (use for long outputs like generation); result is the final message either way. */
  stream?: boolean;
  timeoutMs?: number;
  traceId?: string;
  /** Required: deterministic output used when LLM_PROVIDER=mock. */
  mock: MockFn;
}

export interface CallModelResult {
  text: string;
  callId: string;
  /** Record whether the caller could parse/validate the output (shown in the Inspector). */
  report(parseOk: boolean, error?: string): void;
}

export type CallModel = (input: CallModelInput) => Promise<CallModelResult>;
