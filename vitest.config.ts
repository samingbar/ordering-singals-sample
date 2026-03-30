import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      exclude: [
        '**/workflow-bundle-*.js',
        'vitest.config.ts',
        'src/apps/**',
        'src/shared/**',
        'src/test/**',
        'src/**/run.ts',
        'src/**/worker.ts',
        'src/**/*_workflow.ts',
      ],
      thresholds: {
        branches: 70,
        functions: 80,
        lines: 80,
        statements: 80,
      },
    },
  },
});
