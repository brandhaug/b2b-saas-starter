import { assert, describe } from 'vite-plus/test'
import { createRuleHarness } from '../../test/harness.ts'

const rule = createRuleHarness('starter/no-effect-escape-hatch')

describe('starter/no-effect-escape-hatch', () => {
  rule.valid(
    'allows typed failures',
    `
			import { Effect } from 'effect'

			export const boom = Effect.fail({ _tag: 'Boom' as const })
		`
  )

  rule.valid(
    'allows a local binding named die',
    `
			const die = 6
			export const roll = die + 1
		`
  )

  rule.valid(
    'allows an object property named die',
    `
			export const handlers = { die: () => 'noop' }
		`
  )

  rule.valid(
    'allows member names that only start with die',
    `
			import { Effect } from 'effect'

			export const run = Effect.dieless
		`
  )

  rule.invalid(
    'reports Effect.die',
    `
			import { Effect } from 'effect'

			export const boom = Effect.die(new Error('unreachable'))
		`,
    (messages) => {
      assert.match(messages, /Avoid die\./)
      assert.match(messages, /fail with a tagged error/)
    }
  )

  rule.invalid(
    'reports orDie in a pipeline',
    `
			import { Effect } from 'effect'

			export const run = (self: Effect.Effect<number, string>) => self.pipe(Effect.orDie)
		`,
    (messages) => {
      assert.match(messages, /Avoid orDie\./)
    }
  )

  rule.invalid(
    'reports dieMessage',
    `
			import { Effect } from 'effect'

			export const boom = Effect.dieMessage('unreachable')
		`
  )

  rule.invalid(
    'reports inside test files, because the exemption lives in .oxlintrc.json',
    `
			import { Effect } from 'effect'

			export const run = (self: Effect.Effect<number, string>) =>
				self.pipe(Effect.orDieWith((error) => new Error(error)))
		`,
    (messages) => {
      assert.match(messages, /Avoid orDieWith\./)
    },
    { filename: 'thing.test.ts' }
  )
})
