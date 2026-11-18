import { assert, describe } from 'vite-plus/test'
import { createRuleHarness } from '../../test/harness.ts'

const rule = createRuleHarness('starter/no-test-retry')

describe('starter/no-test-retry', () => {
  for (const [name, code] of [
    ['it options before the body', "it('flakes', { retry: 2 }, () => {})"],
    ['test options after the body', "test('flakes', () => {}, { retry: 2 })"],
    ['describe options', "describe('suite', { retry: 3 }, () => {})"],
    ['suite options', "suite('suite', { retry: 3 }, () => {})"],
    ['a modifier chain', "it.concurrent('flakes', { retry: 2 }, () => {})"],
    ['an each case', "test.each([1])('flakes %i', { retry: 2 }, () => {})"],
    [
      'an Effect tester',
      "it.effect('flakes', () => Effect.void, { retry: 2, timeout: 1000 })"
    ],
    [
      'a layer callback tester',
      "layer(Live)('suite', (it) => {\n  it.effect('flakes', () => Effect.void, { retry: 2 })\n})"
    ],
    ['a string key', "it('flakes', { 'retry': 2 }, () => {})"],
    ['a non-literal count', "it('flakes', { retry: attempts }, () => {})"],
    ['vi.setConfig', 'vi.setConfig({ retry: 2 })'],
    ['a Vitest config block', 'export default defineConfig({ test: { retry: 2 } })'],
    [
      'a Vitest project block',
      "export default defineConfig({ test: { projects: [{ test: { name: 'unit', retry: 1 } }] } })"
    ],
    [
      'Playwright configuration',
      "import { defineConfig } from '@playwright/test'\nexport default defineConfig({ retries: 2 })"
    ],
    [
      'aliased Playwright configuration',
      "import { defineConfig as config } from '@playwright/test'\nexport default config({ retries: process.env.CI ? 2 : 0 })"
    ]
  ] as const) {
    rule.invalid(`rejects a retry in ${name}`, `${code}\n`, (message) => {
      assert.include(message, 'first-attempt')
    })
  }

  rule.valid(
    'allows an explicit zero',
    `it('settles', { retry: 0 }, () => {})
export default defineConfig({ test: { retry: 0 } })
`
  )

  rule.valid(
    'allows Playwright configuration without retries',
    `import { defineConfig } from '@playwright/test'
export default defineConfig({ retries: 0, timeout: 30_000 })
`
  )

  rule.valid(
    'allows timeouts and other test options',
    `it('settles', { timeout: 1000, concurrent: true }, () => {})
test.each([{ retry: 2 }])('case %o', (row) => {})
`
  )

  rule.valid(
    'allows retry keys outside test configuration',
    `const client = createClient({ retry: 3 })
const policy = Effect.retry(effect, { times: 3 })
const config = defineConfig({ retries: 2 })
`
  )

  rule.valid(
    'allows a test block whose value is not an object',
    `const flags = { test: true, retry: 2 }
`
  )
})
