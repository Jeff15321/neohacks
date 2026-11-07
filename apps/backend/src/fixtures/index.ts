import type { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import { registerFixtureApiRoutes } from './netApi.js';

/**
 * Test/demo fixture sites (repo `fixtures/`), served without auth. URL prefixes are stable — specs, tools and
 * mock widgets rely on them. Phases add fixtures by appending to STATIC (and an API module next to netApi.ts).
 */
export const STATIC: Array<{ dir: string; prefix: string }> = [
  { dir: 'gmail', prefix: '/fixture/' },
  { dir: 'youtube', prefix: '/fixture-yt/' },
  { dir: 'gmail2', prefix: '/fixture-g2/' },
  { dir: 'net', prefix: '/fixture-net/' },
];

export async function registerFixtures(app: FastifyInstance, repoRoot: string) {
  registerFixtureApiRoutes(app);
  for (const [i, f] of STATIC.entries()) {
    await app.register(fastifyStatic, { root: path.resolve(repoRoot, 'fixtures', f.dir), prefix: f.prefix, decorateReply: i === 0 });
  }
}
