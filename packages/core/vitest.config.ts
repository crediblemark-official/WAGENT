import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
    exclude: ['src/__tests__/storage.test.ts', 'src/__tests__/scheduler.test.ts', 'src/__tests__/e2e.test.ts', 'src/__tests__/gateway.test.ts', 'src/__tests__/knowledge-store.test.ts', 'src/__tests__/agent.test.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'clover'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.d.ts'],
    },
  },
});
