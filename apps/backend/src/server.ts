import Fastify, { type FastifyInstance } from 'fastify';
import { fileURLToPath } from 'node:url';
import { loadConfig, type Config } from './config.js';
import { openDb } from './store/db.js';
import { createCallModel, makeProvider } from './llm/callModel.js';
import { registerPlugins } from './plugins/index.js';
import { registerFixtures } from './fixtures/index.js';
import type { ModuleDeps, RegisterModule } from './modules/types.js';
import { registerGenerate } from './modules/generate/routes.js';
import { registerInference } from './modules/inference/routes.js';
import { registerDebug } from './modules/debug/routes.js';

/** Backend modules. Phases append theirs (assist, observe, recordings, jobs, data). */
const MODULES: RegisterModule[] = [registerGenerate, registerInference, registerDebug];

export async function buildApp(cfg: Config = loadConfig(), opts: { logger?: boolean } = {}): Promise<{ app: FastifyInstance; deps: ModuleDeps }> {
  const db = openDb(cfg.dataDbPath);
  const provider = makeProvider(cfg);
  const deps: ModuleDeps = { cfg, db, callModel: createCallModel(provider, db) };
  const app = Fastify({
    logger: opts.logger === false ? false : { level: process.env.LOG_LEVEL ?? 'info' },
    disableRequestLogging: true,
    bodyLimit: 4 * 1024 * 1024,
  });
  registerPlugins(app, cfg);
  app.get('/health', async () => ({ ok: true, provider: provider.name, models: { ...cfg.models } }));
  for (const register of MODULES) await register(app, deps);
  await registerFixtures(app, cfg.repoRoot);
  app.addHook('onClose', async () => { db.close(); });
  return { app, deps };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const cfg = loadConfig();
  const { app } = await buildApp(cfg);
  try {
    await app.listen({ port: cfg.port, host: '127.0.0.1' });
    app.log.info({ module: 'server', event: 'listening', ok: true }, `backend up on http://127.0.0.1:${cfg.port} (provider=${cfg.provider}, models=${JSON.stringify(cfg.models)})`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}
