import { describe } from 'vite-plus/test'
import { createRuleHarness } from './harness.ts'

describe('no-browser-test-inflation', () => {
  const { valid, invalid } = createRuleHarness('starter/no-browser-test-inflation')
  const imported = "import { test as check } from '@playwright/test';\n"
  for (const code of [
    'check.setTimeout(60000)',
    "check['setTimeout'](60000)",
    'check.slow()',
    'check.describe.configure({ timeout: 60000 })',
    "check.describe.configure({ ['retries']: 2 })"
  ]) {
    invalid(code, imported + code)
  }
  invalid('namespace import', "import * as pw from '@playwright/test'; pw.test.slow()")
  valid('unrelated object', 'test.setTimeout(60000)')
  valid('shadowed import', `${imported}function f(check) { check.slow() }`)
  valid(
    'mode configuration',
    `${imported}check.describe.configure({ mode: 'parallel' })`
  )
  valid('operation deadlines', `${imported}page.click({ timeout: 5000 })`)
  valid(
    'event waits',
    `${imported}page.waitForResponse('/api'); page.waitForEvent('download')`
  )
  valid('dynamic key limitation', `${imported}check[method](60000)`)
  valid('assignment alias limitation', `${imported}const alias = check; alias.slow()`)
})
