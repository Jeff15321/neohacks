import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Models {
  /** Widget generation / repair / edit, workflow interpreter, judge. */
  generation: string;
  /** Widget runtime inference, activity model, assist "create". */
  inference: string;
  /** Fast stages: step interpreter, assist "decide". */
  fast: string;
}

export interface Config {
  port: number;
  provider: 'anthropic' | 'mock';
  /** Stages forced onto their deterministic mock even with a live provider (LLM_MOCK_STAGES=a,b) — live evals of one stage. */
  mockStages: string[];
  anthropicApiKey?: string;
  models: Models;
  authToken?: string;
  /** sqlite file (node:sqlite); ':memory:' in unit tests / E2E. */
  dataDbPath: string;
  repoRoot: string;
}

const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');

/** Fallback: read KEY=VALUE lines from the repo .env if vars are absent (never overrides real env). */
function dotenvFallback(): void {
  try {
    const f = resolve(REPO_ROOT, '.env');
    if (!existsSync(f)) return;
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* no .env — fine */ }
}

/**
 * Model ids are env-configurable via LLM_MODEL_GENERATION / LLM_MODEL_INFERENCE / LLM_MODEL_FAST.
 * The MVP's LLM_GENERATION_MODEL / LLM_INFERENCE_MODEL are deliberately ignored (they pinned 4.5-era models).
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  if (env === process.env) dotenvFallback();
  return {
    port: Number(env.BACKEND_PORT ?? 8787),
    provider: env.LLM_PROVIDER === 'mock' ? 'mock' : 'anthropic',
    mockStages: (env.LLM_MOCK_STAGES ?? '').split(',').map(s => s.trim()).filter(Boolean),
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    models: {
      generation: env.LLM_MODEL_GENERATION ?? 'claude-opus-5-5',
      inference: env.LLM_MODEL_INFERENCE ?? 'claude-sonnet-5-5',
      fast: env.LLM_MODEL_FAST ?? 'claude-haiku-5-5',
    },
    authToken: env.EXTENSION_AUTH_TOKEN,
    dataDbPath: env.DATA_DB_PATH ?? resolve(REPO_ROOT, '.data/store.db'),
    repoRoot: env.REPO_ROOT ?? REPO_ROOT,
  };
}
