export interface Config {
  port: number;
  provider: 'anthropic' | 'openai' | 'mock';
  anthropicApiKey?: string;
  openaiApiKey?: string;
  generationModel: string;
  inferenceModel: string;
  authToken?: string;
  repoRoot: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: Number(env.BACKEND_PORT ?? 8787),
    provider: (env.LLM_PROVIDER ?? 'anthropic') as Config['provider'],
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    openaiApiKey: env.OPENAI_API_KEY,
    generationModel: env.LLM_GENERATION_MODEL ?? 'claude-sonnet-4-5',
    inferenceModel: env.LLM_INFERENCE_MODEL ?? 'claude-haiku-4-5',
    authToken: env.EXTENSION_AUTH_TOKEN,
    repoRoot: env.REPO_ROOT ?? new URL('../../..', import.meta.url).pathname,
  };
}
