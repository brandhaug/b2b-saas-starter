import { describe } from 'vite-plus/test'
import { lintConfig } from '../../../lint.config.ts'
import { createRuleHarness } from './harness.ts'

describe('root browser policy scope', () => {
  for (const rule of [
    'starter/no-browser-test-inflation',
    'no-restricted-properties'
  ]) {
    let ruleId = rule
    let call = "import { test } from '@playwright/test'; test.setTimeout(60000)"
    if (rule === 'no-restricted-properties') {
      ruleId = `eslint/${rule}`
      call = 'page.waitForTimeout(100)'
    }
    const overrides = (lintConfig.overrides ?? []).flatMap((override) => {
      const setting = override.rules?.[rule]
      if (setting !== 'off' && setting !== 'error' && !Array.isArray(setting)) {
        return []
      }
      return [{ files: override.files, rules: { [ruleId]: setting } }]
    })
    const { valid, invalid } = createRuleHarness(ruleId, {}, overrides)
    for (const filename of [
      'apps/web/e2e/example.spec.ts',
      'apps/web/e2e/helpers.ts'
    ]) {
      invalid(`${rule} applies to ${filename}`, call, undefined, { filename })
    }
    for (const filename of [
      'apps/web/playwright.config.ts',
      'packages/ai/src/example.test.ts',
      'scripts/example.ts'
    ]) {
      valid(`${rule} excludes ${filename}`, call, { filename })
    }
  }
})
