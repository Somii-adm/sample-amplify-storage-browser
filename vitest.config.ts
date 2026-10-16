import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^\$amplify\/env\/.*$/,
        replacement: fileURLToPath(new URL('./amplify/functions/test-env.ts', import.meta.url)),
      },
    ],
  },
  test: {
    environment: 'node',
    include: ['amplify/functions/**/handler.test.ts'],
  },
});