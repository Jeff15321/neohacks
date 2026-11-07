// Extension build: esbuild bundles + Tailwind v4 CSS + static assets → dist/.
// Compile-time config: BACKEND_URL, EXTENSION_AUTH_TOKEN.
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(DIR, 'dist');
const src = (p) => path.join(DIR, 'src', p);
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

const define = {
  BACKEND_URL: JSON.stringify(process.env.BACKEND_URL ?? 'http://127.0.0.1:8787'),
  EXTENSION_TOKEN: JSON.stringify(process.env.EXTENSION_AUTH_TOKEN ?? 'dev-token-change-me'),
  'process.env.NODE_ENV': JSON.stringify('production'),
};
const common = { bundle: true, format: 'iife', target: 'chrome120', define, sourcemap: true, logLevel: 'warning', legalComments: 'none' };

await Promise.all([
  esbuild.build({ ...common, entryPoints: [src('background/main.ts')], outfile: path.join(DIST, 'sw.js') }),
  esbuild.build({ ...common, entryPoints: [src('page/netprobe.ts')], outfile: path.join(DIST, 'netprobe.js') }),
  esbuild.build({ ...common, entryPoints: [src('content/main.ts')], outfile: path.join(DIST, 'content.js') }),
  esbuild.build({ ...common, entryPoints: [src('panel/main.tsx')], outfile: path.join(DIST, 'panel.js'), jsx: 'automatic' }),
]);

// Tailwind v4 (scans src/panel via @source in styles.css)
const require = createRequire(import.meta.url);
const twCli = path.join(path.dirname(require.resolve('@tailwindcss/cli/package.json')), 'dist/index.mjs');
execFileSync(process.execPath, [twCli, '-i', src('panel/styles.css'), '-o', path.join(DIST, 'panel.css'), '--minify'], { cwd: DIR, stdio: ['ignore', 'ignore', 'inherit'] });

fs.copyFileSync(src('panel/index.html'), path.join(DIST, 'sidepanel.html'));
fs.copyFileSync(path.join(DIR, 'manifest.json'), path.join(DIST, 'manifest.json'));
const kb = (f) => (fs.statSync(path.join(DIST, f)).size / 1024).toFixed(0) + 'K';
console.log(`extension built -> ${DIST} (sw ${kb('sw.js')}, netprobe ${kb('netprobe.js')}, content ${kb('content.js')}, panel ${kb('panel.js')} + ${kb('panel.css')} css) backend=${JSON.parse(define.BACKEND_URL)}`);
