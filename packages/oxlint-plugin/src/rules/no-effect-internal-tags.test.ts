import { assert, describe } from 'vite-plus/test'
import { createRuleHarness } from '../../test/harness.ts'

const rule = createRuleHarness('starter/no-effect-internal-tags')

describe('starter/no-effect-internal-tags', () => {
  rule.valid(
    'allows the public guards',
    `
			import { Option } from 'effect'

			export const has = (value: Option.Option<string>) => Option.isSome(value)
		`
  )

  rule.valid(
    'allows _tag checks when no Effect module is imported',
    `
			type Event = { readonly _tag: 'Some' }

			export const isSome = (event: Event) => event._tag === 'Some'
		`
  )

  rule.valid(
    'allows _tag checks on the repo own tagged unions',
    `
			import { Option } from 'effect'

			type Event = { readonly _tag: 'WorkspaceCreated' }

			export const isCreated = (event: Event) => event._tag === 'WorkspaceCreated'
		`
  )

  rule.valid(
    'allows Cause tags when Cause is not imported',
    `
			import { Data } from 'effect'

			type Wrapped = { readonly _tag: 'Die' }

			export const unwrap = (value: Wrapped) => Data.struct(value)._tag === 'Die'
		`
  )

  rule.valid(
    'keeps Cause tags gated on importing Cause',
    `
			import { Schema } from 'effect'

			type Step = { readonly _tag: 'Fail' | 'Done' }

			export const failed = (step: Step) => step._tag === 'Fail' && Schema.String
		`
  )

  rule.valid(
    'allows Some checks in a file that imports nothing from Effect',
    `
			import { decodeFrame } from './protocol'

			export const isSome = (data: string) => decodeFrame(data)._tag === 'Some'
		`
  )

  rule.invalid(
    'reports a Some check on a decoded Option when only Schema is imported',
    `
			import { Schema } from 'effect'

			const decodeEvent = Schema.decodeUnknownOption(Schema.String)

			export const read = (raw: unknown) => {
				const event = decodeEvent(raw)
				if (event._tag === 'Some') {
					return event.value
				}
				return null
			}
		`,
    (messages) => {
      assert.match(messages, /Comparing _tag to "Some" reads an Effect internal/)
      assert.match(messages, /Option\.isSome/)
    }
  )

  rule.invalid(
    'reports a Failure check on a decoded Result when only Schema is imported',
    `
			import { Schema } from 'effect'

			const decodeClaims = Schema.decodeUnknownResult(Schema.String)

			export const claims = (raw: unknown) => decodeClaims(raw)._tag !== 'Failure'
		`,
    (messages) => {
      assert.match(messages, /Result\.isFailure/)
    }
  )

  rule.invalid(
    'reports Success and None checks with an Effect subpath import only',
    `
			import { HttpClient } from 'effect/http'

			type Value = { readonly _tag: string }

			export const ok = (value: Value) => value._tag === 'Success' || HttpClient
			export const missing = (value: Value) => 'None' == value._tag
		`,
    (messages) => {
      assert.match(messages, /Comparing _tag to "Success"/)
      assert.match(messages, /Comparing _tag to "None"/)
    }
  )

  rule.invalid(
    'reports a None check with Option imported from the barrel',
    `
			import { Option } from 'effect'

			export const missing = (value: Option.Option<string>) => value._tag === 'None'
		`,
    (messages) => {
      assert.match(messages, /Comparing _tag to "None" reads an Effect internal/)
      assert.match(messages, /Option\.isNone/)
    }
  )

  rule.invalid(
    'reports a Some check with Option imported as a submodule namespace',
    `
			import * as Option from 'effect/Option'

			export const missing = (value: Option.Option<string>) => value._tag !== 'Some'
		`
  )

  rule.invalid(
    'reports a Failure check with Result imported',
    `
			import { Result } from 'effect'

			export const failed = (value: Result.Result<string, string>) =>
				'Failure' === value._tag
		`,
    (messages) => {
      assert.match(messages, /Result\.isFailure/)
    }
  )

  rule.invalid(
    'reports a computed _tag access',
    `
			import { Option } from 'effect'

			export const missing = (value: Option.Option<string>) => value['_tag'] === 'None'
		`
  )
})
