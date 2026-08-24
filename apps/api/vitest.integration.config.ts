import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * The DB-backed suite. Requires the Compose PostgreSQL container to be running; the global setup
 * creates and migrates a dedicated `retailbooks_test` database.
 *
 * The SWC plugin is required rather than optional: Nest resolves constructor dependencies from
 * `emitDecoratorMetadata`, which vitest's default esbuild transform does not emit. Without it every
 * injected dependency arrives as `undefined`.
 *
 * Files run one at a time in a single process: every spec truncates the shared test database, so
 * running them in parallel would have them clearing each other's fixtures.
 */
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/**/*.int.test.ts'],
    globalSetup: ['test/support/global-setup.ts'],
    setupFiles: ['test/support/setup-env.ts'],
    fileParallelism: false,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
