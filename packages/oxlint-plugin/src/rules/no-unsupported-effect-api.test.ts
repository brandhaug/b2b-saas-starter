import { assert, describe } from 'vitest'
import { createRuleHarness } from '../../test/harness.ts'

const rule = createRuleHarness('starter/no-unsupported-effect-api')

describe('starter/no-unsupported-effect-api', () => {
  rule.valid(
    'allows the Effect v4 replacements',
    `
			import { Effect } from 'effect'

			export const adapted = Effect.callback<number>((resume) => {
				resume(Effect.succeed(1))
			})
		`
  )

  rule.valid(
    'allows Effect.andThen and Effect.timeoutOrElse',
    `
			import { Effect } from 'effect'

			export const run = Effect.succeed(1).pipe(
				Effect.andThen(Effect.succeed(2)),
				Effect.timeoutOrElse({ duration: '1 second', onTimeout: () => Effect.succeed(0) })
			)
		`
  )

  rule.valid(
    'allows the same member names on other namespaces',
    `
			import { Stream } from 'effect'

			export const numbers = Stream.async<number>(() => {})
		`
  )

  rule.invalid(
    'reports Effect.async',
    `
			import { Effect } from 'effect'

			export const adapted = Effect.async<number>(() => {})
		`,
    (messages) => {
      assert.match(messages, /Effect\.async does not exist in Effect v4/)
      assert.match(messages, /Effect\.callback/)
    }
  )

  rule.invalid(
    'reports Effect.zipRight',
    `
			import { Effect } from 'effect'

			export const run = Effect.zipRight(Effect.succeed(1), Effect.succeed(2))
		`,
    (messages) => {
      assert.match(messages, /Use Effect\.andThen/)
    }
  )

  rule.invalid(
    'reports Effect.timeoutFail',
    `
			import { Effect } from 'effect'

			export const run = Effect.succeed(1).pipe(
				Effect.timeoutFail({ duration: '1 second', onTimeout: () => 'timeout' })
			)
		`,
    (messages) => {
      assert.match(messages, /Use Effect\.timeoutOrElse/)
    }
  )
})
