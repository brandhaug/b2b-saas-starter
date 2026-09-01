import { assert, describe } from 'vite-plus/test'
import { createRuleHarness } from '../../test/harness.ts'

const rule = createRuleHarness('starter/no-inline-schema-compile')

describe('starter/no-inline-schema-compile', () => {
  rule.valid(
    'allows compilers hoisted to module scope',
    `
			import { Schema } from 'effect'

			const User = Schema.Struct({ name: Schema.String })
			const decodeUser = Schema.decodeUnknownSync(User)

			export function parseUser(input: unknown) {
				return decodeUser(input)
			}
		`
  )

  rule.valid(
    'allows a compiler bound once inside a factory, since it is not invoked in place',
    `
			import { Schema } from 'effect'

			const User = Schema.Struct({ name: Schema.String })

			export function makeParser() {
				const decode = Schema.decodeUnknownSync(User)
				return decode
			}
		`
  )

  rule.valid(
    'allows a compiler invoked at module scope',
    `
			import { Schema } from 'effect'

			const User = Schema.Struct({ name: Schema.String })
			export const user = Schema.decodeUnknownSync(User)({ name: 'ada' })
		`
  )

  rule.valid(
    'allows a schema taken as a parameter, which cannot be hoisted',
    `
			import { Schema } from 'effect'

			export function parseWith(schema: Schema.Top, input: unknown) {
				return Schema.decodeUnknownSync(schema)(input)
			}
		`
  )

  rule.invalid(
    'reports the background worker queue decode pattern',
    `
			import { Schema } from 'effect'

			const WebhookQueueMessage = Schema.Struct({ traceparent: Schema.String })

			export function queueParentSpan(envelope: { body: unknown }) {
				return Schema.decodeUnknownResult(WebhookQueueMessage)(envelope.body)
			}
		`,
    (messages) => {
      assert.match(
        messages,
        /Hoist Schema\.decodeUnknownResult\(\.\.\.\) to module scope/
      )
      assert.match(messages, /compiled function is rebuilt on every call/)
    }
  )

  rule.invalid(
    'reports an inline schema literal with the stronger message',
    `
			import { Schema } from 'effect'

			export const parseUser = (input: unknown) =>
				Schema.decodeUnknownSync(Schema.Struct({ name: Schema.String }))(input)
		`,
    (messages) => {
      assert.match(messages, /inline schema and the compiled function are rebuilt/)
    }
  )

  rule.invalid(
    'reports a guard compiled inside a function body',
    `
			import { Schema } from 'effect'

			const User = Schema.Struct({ name: Schema.String })

			export function isUser(input: unknown) {
				return Schema.is(User)(input)
			}
		`
  )

  rule.invalid(
    'reports a compiler inside a generator body',
    `
			import { Effect, Schema } from 'effect'

			const Payload = Schema.Struct({ id: Schema.String })

			export const load = Effect.gen(function* () {
				const raw: unknown = yield* Effect.succeed({ id: 'a' })
				return Schema.decodeUnknownOption(Payload)(raw)
			})
		`
  )
})
