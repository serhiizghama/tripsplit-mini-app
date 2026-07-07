import { defineConfig } from 'vitest/config';

/**
 * Phase 7 test setup — pure-logic unit tests only (plural selector, i18n
 * dictionary completeness): no component rendering, so plain `node`
 * environment is enough (no jsdom dependency to add just for this).
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
