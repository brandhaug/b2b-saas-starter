import { defineConfig } from '@playwright/test'
import config from '../../playwright.config.ts'

export default defineConfig({
  ...config,
  testDir: import.meta.dirname,
  testMatch: 'regression.spec.ts',
  projects: [{ name: 'policy', use: { browserName: 'chromium' } }],
  workers: 1,
  reporter: [['list'], ['json', { outputFile: process.env.POLICY_REPORT }]],
  outputDir: process.env.POLICY_OUTPUT ?? '.context/browser-policy',
  use: { ...config.use, baseURL: `http://127.0.0.1:${process.env.POLICY_PORT}` },
  webServer: {
    command: `node ${import.meta.dirname}/server.mjs`,
    url: `http://127.0.0.1:${process.env.POLICY_PORT}`,
    reuseExistingServer: false
  }
})
