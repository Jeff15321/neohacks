import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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

/** Fallback: read KEY=VALUE lines from a .env file if vars are absent. */
function dotenvFallback(): void {
  try {
    for (const dir of [process.cwd(), resolve(process.cwd(), '../..')]) {
      const f = resolve(dir, '.env');
      if (!existsSync(f)) continue;
      for (const line of readFileSync(f, 'utf8').split('\n')) {
        const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
        if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
      break;
    }
  } catch { /* no .env — fine */ }
}
dotenvFallback();

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
