import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/*/test/**/*.test.ts',
      'supabase/functions/**/test/*.test.ts',
      'apps/report/test/**/*.test.{ts,tsx}',
    ],
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
