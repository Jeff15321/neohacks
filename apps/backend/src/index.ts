import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { makeProvider } from './llm/index.js';
import { registerGenerateRoutes } from './routes/generate.js';
import { registerInferenceRoutes } from './routes/inference.js';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const cfg = loadConfig();
const llm = makeProvider(cfg);
const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });

// Simple shared-secret guard so random sites/tabs can't burn LLM quota.
app.addHook('onRequest', async (req, reply) => {
  if (req.url === '/health' || req.url.startsWith('/fixture')) return;
  if (cfg.authToken && req.headers['x-extension-token'] !== cfg.authToken) {
    reply.code(401).send({ ok: false, error: 'unauthorized' });
  }
});

app.get('/health', async () => ({ ok: true, provider: llm.name }));

registerGenerateRoutes(app, llm, cfg);
registerInferenceRoutes(app, llm, cfg);

// Serve the Gmail-like fixture app for E2E tests + demos.
const fixtureDir = path.resolve(DIR, '../../fixture-gmail');
await app.register(fastifyStatic, { root: fixtureDir, prefix: '/fixture/' });
await app.register(fastifyStatic, {
  root: path.resolve(DIR, '../../fixture-youtube'),
  prefix: '/fixture-yt/', decorateReply: false,
});
await app.register(fastifyStatic, {
  root: path.resolve(DIR, '../../fixture-gmail2'),
  prefix: '/fixture-g2/', decorateReply: false,
});

const port = cfg.port;
try {
  await app.listen({ port, host: '127.0.0.1' });
  app.log.info(`backend up on http://127.0.0.1:${port} (provider=${llm.name}, fixture=/fixture/)`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
