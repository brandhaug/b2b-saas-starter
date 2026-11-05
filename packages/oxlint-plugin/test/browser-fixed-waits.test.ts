import { describe } from 'vite-plus/test'
import { createRuleHarness } from './harness.ts'

describe('bundled browser fixed-wait restriction', () => {
  const { valid, invalid } = createRuleHarness(
    'eslint/no-restricted-properties',
    {},
    undefined,
    [{ property: 'waitForTimeout', message: 'Wait for observable readiness.' }]
  )
  invalid('fixed wait', 'page.waitForTimeout(100)')
  invalid('computed wait', "page['waitForTimeout'](100)")
  invalid('receiver alias', 'const browserPage = page; browserPage.waitForTimeout(100)')
  valid('response readiness', "page.waitForResponse('/api')")
  valid('event readiness', "page.waitForEvent('download')")
  valid('operation timeout', 'page.click({ timeout: 5000 })')
  valid('dynamic key limitation', 'page[method](100)')
})
