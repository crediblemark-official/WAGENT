import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      '../whatsapp/src/__tests__/**/*.test.ts',
      '../cli/src/__tests__/**/*.test.ts',
    ],
  },
});
