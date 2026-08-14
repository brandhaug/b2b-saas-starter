import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 5000 },
  use: {
    baseURL: 'http://localhost:3071',
    trace: 'on-first-retry'
  },
  webServer: {
    command: 'bun run dev',
    url: 'http://localhost:3071',
    // Locally a dev server on :3071 is usually already running and reusing it
    // saves a cold start. CI always starts its own: a process still holding
    // the port there is a leak from an earlier step, and silently testing
    // against it would hide the real state of the branch.
    reuseExistingServer: !process.env.CI,
    // The dev server answers in ~5s locally and ~9s on CI. The headroom is for
    // the workerd proxy behind the `DB` binding (see
    // src/lib/cloudflare-workers-shim-dev.ts), which is the slow part of a
    // cold start.
    timeout: 180_000,
    // Vite writes its ready banner and the D1 attach notice to stdout, which
    // Playwright drops by default. Without them a startup timeout says only
    // that the URL never answered.
    stdout: 'pipe'
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ]
})
