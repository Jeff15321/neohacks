import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Build the extension pointed at this run's backend port, so every run tests fresh code. */
export default function globalSetup() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const port = process.env.E2E_PORT ?? '8787';
  execFileSync('npm', ['run', 'build', '-w', 'apps/extension'], {
    cwd: root,
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, BACKEND_URL: `http://127.0.0.1:${port}`, EXTENSION_AUTH_TOKEN: 'dev-token-change-me' },
  });
}
