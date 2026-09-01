import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  // 90s, not 30s: specs run in parallel workers, and the first ones to open
  // /sign-in pay Vite's full cold-transform bill — much heavier since React
  // Compiler joined the dev pipeline (#135). On a cold CI runner that bill
  // alone ate the old 30s budget before hydration could finish.
  timeout: 90_000,
  expect: { timeout: 5000 },
  // One retry in CI: the remaining variance is dev-server warm-up, not app
  // behaviour, and a rerun lands on an already-warm transform cache.
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: 'http://localhost:3071',
    trace: 'on-first-retry'
  },
  webServer: {
    // --strictPort: without it Vite silently serves on 3072 when :3071 is
    // taken, and the readiness probe below polls :3071 until the webServer
    // timeout — a three-minute hang whose only symptom is a missing banner.
    // Fail fast instead so the cause is visible.
    command: 'pnpm run dev -- --strictPort',
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
