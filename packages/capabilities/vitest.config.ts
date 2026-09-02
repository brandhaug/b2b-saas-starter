import { defineConfig } from 'vite-plus'

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text-summary'],
      include: ['src/**/*.ts'],
      // `src/testing/**` is the live suites' D1 fixture and fake plugin
      // bindings — test infrastructure, like the `*.test.ts` files it serves.
      exclude: ['src/**/*.test.ts', 'src/testing/**'],
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
