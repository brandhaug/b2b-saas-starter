import { assert, describe } from 'vite-plus/test'
import { createRuleHarness } from '../../test/harness.ts'

const rule = createRuleHarness('starter/no-fixed-sleep')

describe('starter/no-fixed-sleep', () => {
  for (const [name, sleep] of [
    ['an arrow executor', 'await new Promise((resolve) => setTimeout(resolve, 50))'],
    [
      'a block executor',
      'await new Promise((resolve) => {\n    setTimeout(resolve, 0)\n  })'
    ],
    ['a wrapped resolve', 'await new Promise((done) => setTimeout(() => done(), 50))'],
    [
      'globalThis.setTimeout',
      'await new Promise((resolve) => globalThis.setTimeout(resolve, 50))'
    ],
    [
      'window.setTimeout',
      'await new Promise((resolve) => window.setTimeout(resolve, 50))'
    ],
    ['scheduler.wait', 'await scheduler.wait(50)']
  ] as const) {
    rule.invalid(
      `rejects ${name} in a test body`,
      `import { it } from 'vite-plus/test'

it('settles', async () => {
  ${sleep}
})
`,
      (message) => {
        assert.include(message, 'await the operation')
      }
    )
  }

  rule.invalid(
    'rejects an aliased timers/promises setTimeout',
    `import { setTimeout as sleep } from 'node:timers/promises'

test('settles', async () => {
  await sleep(50)
})
`
  )

  rule.invalid(
    'rejects an unaliased timers/promises setTimeout',
    `import { setTimeout } from 'timers/promises'

it('settles', async () => {
  await setTimeout(50)
})
`
  )

  for (const hook of ['beforeEach', 'afterEach', 'beforeAll', 'afterAll']) {
    rule.invalid(
      `rejects a sleep in ${hook}`,
      `${hook}(async () => {
  await new Promise((resolve) => setTimeout(resolve, 50))
})
`
    )
  }

  rule.invalid(
    'rejects a sleep in a test.each case',
    `test.each([1, 2])('settles %i', async () => {
  await new Promise((resolve) => setTimeout(resolve, 50))
})
`
  )

  rule.invalid(
    'rejects a sleep in a Playwright test',
    `import { test } from '@playwright/test'

test('settles', async ({ page }) => {
  await new Promise((resolve) => setTimeout(resolve, 50))
})
`
  )

  rule.valid(
    'allows sleeps in a file that installs fake timers',
    `import { it, vi } from 'vite-plus/test'

it('advances', async () => {
  vi.useFakeTimers()
  const pending = new Promise((resolve) => setTimeout(resolve, 50))
  await vi.advanceTimersByTimeAsync(50)
  await pending
})
`
  )

  rule.valid(
    'allows a scheduled timer that is not awaited',
    `it('schedules', () => {
  setTimeout(() => {}, 50)
})
`
  )

  rule.valid(
    'allows awaiting a promise that resolves on an event',
    `it('waits for the event', async () => {
  await new Promise((resolve) => emitter.once('done', resolve))
})
`
  )

  rule.valid(
    'allows a timeout race that does more than resolve',
    `it('races', async () => {
  await new Promise((resolve, reject) => {
    setTimeout(resolve, 50)
    emitter.once('error', reject)
  })
})
`
  )

  rule.valid(
    'allows sleeps outside test bodies',
    `export async function backoff() {
  await new Promise((resolve) => setTimeout(resolve, 50))
}
`
  )

  rule.valid(
    'leaves nested helpers to review',
    `it('settles', async () => {
  const pause = async () => {
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  await pause()
})
`
  )

  rule.valid(
    'allows setTimeout from a module other than timers/promises',
    `import { setTimeout } from './clock'

it('settles', async () => {
  await setTimeout(50)
})
`
  )
})
