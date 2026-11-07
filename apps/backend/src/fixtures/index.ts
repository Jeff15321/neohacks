import type { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import { registerFixtureApiRoutes } from './netApi.js';
import { registerTrackerApiRoutes } from './trackerApi.js';

/**
 * Test/demo fixture sites (repo `fixtures/`), served without auth. URL prefixes are stable — specs, tools and
 * mock widgets rely on them. Phases add fixtures by appending to STATIC (and an API module next to netApi.ts).
 */
export const STATIC: Array<{ dir: string; prefix: string }> = [
  { dir: 'gmail', prefix: '/fixture/' },
  { dir: 'youtube', prefix: '/fixture-yt/' },
  { dir: 'gmail2', prefix: '/fixture-g2/' },
  { dir: 'net', prefix: '/fixture-net/' },
  { dir: 'movies', prefix: '/fixture-movies/' }, // Phase A (WidgetAI.db)
  { dir: 'issues', prefix: '/fixture-issues/' },   // Phase F (flow home: GitHub-like, used on 127.0.0.1)
  { dir: 'tracker', prefix: '/fixture-tracker/' }, // Phase F (flow sink: Jira-like, used on localhost)
];

export async function registerFixtures(app: FastifyInstance, repoRoot: string) {
  registerFixtureApiRoutes(app);
  registerTrackerApiRoutes(app); // Phase F
  for (const [i, f] of STATIC.entries()) {
    await app.register(fastifyStatic, { root: path.resolve(repoRoot, 'fixtures', f.dir), prefix: f.prefix, decorateReply: i === 0 });
  }
}
