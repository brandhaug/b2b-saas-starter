import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text-summary'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      // Ratchet, not target: set just below current coverage so CI fails on
      // decay. Raise alongside new tests; never lower to make a build pass.
      thresholds: {
        lines: 75,
        statements: 75,
        functions: 65,
        branches: 60
      }
    }
  }
})
