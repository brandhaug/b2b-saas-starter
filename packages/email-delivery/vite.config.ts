import { defineConfig } from 'vite-plus'

export default defineConfig({
  run: {
    tasks: {
      'test:coverage': {
        command: 'vp test run --coverage',
        // Coverage temp files and pnpm's fresh-install prunedAt timestamp
        // change between runs. Track dependency changes through the lockfile
        // and workspace configuration while retaining automatic source tracking.
        input: [
          { auto: true },
          { pattern: '!node_modules/.modules.yaml', base: 'workspace' },
          { pattern: 'pnpm-lock.yaml', base: 'workspace' },
          { pattern: 'pnpm-workspace.yaml', base: 'workspace' },
          '!coverage/**'
        ]
      }
    }
  },
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text-summary'],
      include: ['src/**/*.ts'],
      // Live and contract modules are exercised by the capabilities package's
      // D1 integration suite; package-local coverage measures the Seed core.
      exclude: [
        'src/**/*.test.ts',
        'src/email-delivery.live.ts',
        'src/email-delivery.contract.ts'
      ],
      thresholds: {
        lines: 86,
        statements: 85,
        functions: 82,
        branches: 74
      }
    }
  }
})
