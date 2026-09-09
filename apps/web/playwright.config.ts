import { defineConfig, devices } from '@playwright/test'

const port = Number(process.env.E2E_PORT ?? 3071)
const baseURL = `http://localhost:${port}`
const devServer = process.env.E2E_SERVER === 'dev'

export default defineConfig({
  testDir: './e2e',
  workers: process.env.CI ? 2 : '50%',
  reporter: [['list'], ['json', { outputFile: 'playwright-report/results.json' }]],
  // Multi-step authentication ceremonies and optional dev-server cold starts
  // share this budget. Built previews avoid transforms during browser tests.
  timeout: 90_000,
  // Hydration is setup: its Locator.waitFor calls use the test budget above.
  // Assertions after the page becomes interactive keep this shorter deadline.
  expect: { timeout: 5000 },
  // Keep a trace for transient browser failures.
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL,
    trace: 'on-first-retry'
  },
  webServer: {
    // --strictPort: without it Vite silently serves on 3072 when :3071 is
    // taken, and the readiness probe below polls :3071 until the webServer
    // timeout — a three-minute hang whose only symptom is a missing banner.
    // Fail fast instead so the cause is visible.
    command: devServer
      ? `pnpm run dev --port ${port} --strictPort`
      : `pnpm run build:e2e && pnpm run serve:e2e --port ${port} --strictPort`,
    url: baseURL,
    env: {
      BETTER_AUTH_URL: baseURL,
      BETTER_AUTH_TRUSTED_ORIGINS: baseURL
    },
    // Locally a dev server on :3071 is usually already running and reusing it
    // saves a cold start. CI always starts its own: a process still holding
    // the port there is a leak from an earlier step, and silently testing
    // against it would hide the real state of the branch.
    reuseExistingServer: devServer && !process.env.CI,
    // Includes the build and local D1 proxy startup.
    timeout: 180_000,
    // Vite writes its ready banner and the D1 attach notice to stdout, which
    // Playwright drops by default. Without them a startup timeout says only
    // that the URL never answered.
    stdout: 'pipe'
  },
  projects: [
    {
      name: 'authentication',
      testMatch: /authentication\.setup\.ts/,
      teardown: 'authentication-cleanup'
    },
    {
      name: 'authentication-cleanup',
      testMatch: /authentication\.teardown\.ts/
    },
    {
      name: 'chromium',
      dependencies: ['authentication'],
      use: { ...devices['Desktop Chrome'] }
    }
  ]
})
