import { assert, describe } from 'vitest'
import { createRuleHarness } from '../../test/harness.ts'

const rule = createRuleHarness('starter/no-unknown-error-message')

describe('starter/no-unknown-error-message', () => {
  rule.valid(
    'allows the sanctioned helper, whose parameter is not failure-named',
    `export function causeMessage(thrown: unknown, fallback: string): string {
  if (thrown instanceof Error && thrown.message.length > 0) return thrown.message
  return fallback
}`
  )

  rule.valid(
    'allows a message read on a catchTag handler parameter',
    `const recovered = effect.pipe(
  Effect.catchTag('RateLimited', (error) => Effect.succeed(error.message))
)`
  )

  rule.valid(
    'allows a message read on a catchTags handler parameter',
    `const recovered = effect.pipe(
  Effect.catchTags({
    RateLimited: (error) => Effect.succeed(error.message),
    Unauthorized: () => Effect.succeed('denied')
  })
)`
  )

  rule.valid(
    'allows reading message off a value that is not failure-named',
    `const notification = { message: 'hello' }
const text = notification.message`
  )

  rule.valid(
    'allows stringifying a value that is not failure-named',
    `const key = String(property)`
  )

  rule.invalid(
    'reports reading message off a caught cause',
    `const text = cause.message`,
    (messages) => {
      assert.match(messages, /Do not read `\.message` off an unknown failure/)
      assert.match(messages, /causeMessage\(thrown, fallback\)/)
    }
  )

  rule.invalid(
    'reports stringifying a caught cause',
    `const text = String(cause)`,
    (messages) => {
      assert.match(messages, /Do not stringify an unknown failure/)
    }
  )

  rule.invalid(
    'reports the instanceof Error probe that the helper replaces',
    `const text = cause instanceof Error ? cause.message : 'Failed'`
  )

  rule.invalid(
    'reports destructuring message out of an error',
    `const { message } = error`,
    (messages) => {
      assert.match(messages, /Do not destructure `message`/)
    }
  )

  rule.invalid(
    'reports a message read on a plain catchAll parameter',
    `const recovered = effect.pipe(Effect.catchAll((error) => Effect.succeed(error.message)))`
  )
})
