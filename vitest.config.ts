import { defineVitestConfig } from '@nuxt/test-utils/config';

export default defineVitestConfig({
  test: {
    // Pure modules run in node; a test opts into the Nuxt runtime with
    // `// @vitest-environment nuxt` at the top of the file.
    environment: 'node',
    include: ['app/**/*.test.ts', 'server/**/*.test.ts', 'shared/**/*.test.ts'],
    // `test/**` holds shared helpers, not tests; @nuxt/test-utils would
    // otherwise pick up `test/nuxt/**` as a test directory of its own.
    exclude: ['node_modules', 'dist', '.nuxt', '.output', 'test/**'],
    // Booting the Nuxt runtime environment compiles the app on first use.
    hookTimeout: 120_000,
    testTimeout: 30_000,
    environmentOptions: {
      nuxt: { domEnvironment: 'happy-dom' },
    },
  },
});
