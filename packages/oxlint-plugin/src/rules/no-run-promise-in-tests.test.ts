import { assert, describe } from 'vite-plus/test'
import { createRuleHarness } from '../../test/harness.ts'

const rule = createRuleHarness('starter/no-run-promise-in-tests')

describe('starter/no-run-promise-in-tests', () => {
  rule.valid(
    'allows the effect to run under the test runner',
    `import { Effect } from 'effect'
import { it } from '@effect/vitest'

it.effect('delivers', () =>
  Effect.gen(function* () {
    const outcome = yield* Effect.succeed('ack')
  }))
`
  )

  rule.valid(
    'allows other Effect members in a test',
    `import { Effect } from 'effect'

const outcome = Effect.runFork(Effect.succeed('ack'))
`
  )

  rule.valid(
    'allows an unrelated object named Effect that is not the namespace',
    `const Effect = { runPromise: (x: unknown) => x }

const outcome = Effect.runPromise('not the runtime')
`
  )

  rule.invalid(
    'reports a hand-started runtime awaiting an effect',
    `import { Effect } from 'effect'

const outcome = await Effect.runPromise(Effect.succeed('ack'))
`,
    (messages) => {
      assert.match(messages, /Effect\.runPromise starts a bare runtime/)
      assert.match(messages, /it\.effect/)
      assert.match(messages, /@effect\/vitest/)
    }
  )

  rule.invalid(
    'reports runPromiseExit, the same hazard with an Exit',
    `import { Effect } from 'effect'

const exit = await Effect.runPromiseExit(Effect.succeed('ack'))
`
  )

  rule.invalid(
    'reports through a renamed namespace import',
    `import { Effect as E } from 'effect'

const outcome = await E.runPromise(E.succeed('ack'))
`
  )

  rule.invalid(
    'reports through a namespace import',
    `import * as Eff from 'effect'

const outcome = await Eff.runPromise(Eff.succeed('ack'))
`
  )
})
