import { defineConfig } from 'vite-plus'

export default defineConfig({
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
