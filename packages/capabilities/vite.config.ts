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
    // Each live suite starts a D1 proxy. Bound concurrent proxies so local
    // validation does not exhaust ephemeral localhost ports.
    maxWorkers: 2,
    coverage: {
      provider: 'v8',
      reporter: ['text-summary'],
      allowExternal: true,
      include: [
        'src/**/*.ts',
        '../billing/src/**/*.ts',
        '../email-delivery/src/**/*.ts'
      ],
      // Billing and email-delivery retain their Live integration tests here.
      // `src/testing/**` is the live suites' D1 fixture and fake plugin
      // bindings — test infrastructure, like the `*.test.ts` files it serves.
      exclude: ['**/*.test.ts', 'src/testing/**'],
      // Ratchet, not target: set just below current coverage so CI fails on
      // decay. Raise alongside new tests; never lower to make a build pass.
      thresholds: {
        lines: 86,
        statements: 85,
        functions: 82,
        branches: 74
      }
    }
  }
})
