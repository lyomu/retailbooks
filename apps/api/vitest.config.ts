import { defineConfig } from 'vitest/config';

/**
 * The fast, DB-free suite. Integration specs are named `*.int.test.ts` and are excluded here so
 * `npm test` stays runnable without any infrastructure.
 */
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', 'test/**/*.int.test.ts'],
  },
});
