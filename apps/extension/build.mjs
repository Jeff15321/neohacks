// Extension build: esbuild for TS bundles + copy static assets to dist/.
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(DIR, 'dist');
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

const define = {
  BACKEND_URL: JSON.stringify(process.env.BACKEND_URL ?? 'http://127.0.0.1:8787'),
  EXTENSION_TOKEN: JSON.stringify(process.env.EXTENSION_AUTH_TOKEN ?? 'dev-token-change-me'),
};

const shared = { bundle: true, format: 'iife', target: 'chrome120', define, sourcemap: true, logLevel: 'warning' };

await esbuild.build({ ...shared, entryPoints: [path.join(DIR, 'src/background/sw.ts')], outfile: path.join(DIST, 'sw.js') });
await esbuild.build({ ...shared, entryPoints: [path.join(DIR, 'src/content/context.ts')], outfile: path.join(DIST, 'content.js') });
await esbuild.build({ ...shared, entryPoints: [path.join(DIR, 'src/sidepanel/main.tsx')], outfile: path.join(DIST, 'sidepanel.js'), jsx: 'automatic' });

fs.copyFileSync(path.join(DIR, 'src/sidepanel/index.html'), path.join(DIST, 'sidepanel.html'));
fs.copyFileSync(path.join(DIR, 'manifest.json'), path.join(DIST, 'manifest.json'));
console.log('extension built ->', DIST);
