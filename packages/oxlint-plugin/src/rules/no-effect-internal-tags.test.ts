import { assert, describe } from 'vitest'
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
    'allows Effect tags when the owning module is not imported',
    `
			import { Data } from 'effect'

			type Wrapped = { readonly _tag: 'Some' }

			export const unwrap = (value: Wrapped) => Data.struct(value)._tag === 'Some'
		`
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
