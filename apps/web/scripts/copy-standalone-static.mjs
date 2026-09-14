import { cpSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * `output: 'standalone'` traces only the server bundle and its node_modules; it deliberately does
 * not copy `.next/static` or `public/` into the standalone output (see the Next.js docs on
 * standalone mode). In this monorepo, the standalone tree mirrors the workspace's path from the
 * repo root (`.next/standalone/apps/web/...`), not the app's own directory, so the copy target is
 * nested accordingly. Runs as a `postbuild` step so `npm run build` alone always leaves a directly
 * runnable standalone server behind -- the e2e harness starts it with a plain `node server.js`.
 */
const appRoot = resolve(import.meta.dirname, '..');
const standaloneApp = resolve(appRoot, '.next/standalone/apps/web');

cpSync(resolve(appRoot, '.next/static'), resolve(standaloneApp, '.next/static'), {
  recursive: true,
});

const publicDir = resolve(appRoot, 'public');
if (existsSync(publicDir)) {
  cpSync(publicDir, resolve(standaloneApp, 'public'), { recursive: true });
}
