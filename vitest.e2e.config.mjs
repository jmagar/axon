import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/__tests__/e2e/**/*.e2e.test.ts'],
    testTimeout: 120000, // 2 minutes for E2E tests
    hookTimeout: 60000, // 1 minute for hooks
    // E2E tests run sequentially to avoid port conflicts
    // In Vitest 4, pool options are top-level
    isolate: false,
    fileParallelism: false,
  },
});
