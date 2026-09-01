import { assert, describe } from 'vite-plus/test'
import { createRuleHarness } from '../../test/harness.ts'

const rule = createRuleHarness('starter/no-schema-class')

describe('starter/no-schema-class', () => {
  rule.valid(
    'allows struct schemas',
    `
			import { Schema } from 'effect'

			export const User = Schema.Struct({ name: Schema.String })
		`
  )

  rule.valid(
    'allows Schema.ErrorClass for typed errors',
    `
			import { Schema } from 'effect'

			export class ParseFailed extends Schema.ErrorClass<ParseFailed>('ParseFailed')({
				reason: Schema.String
			}) {}
		`
  )

  rule.valid(
    'allows Schema.TaggedError for typed errors',
    `
			import { Schema } from 'effect'

// oxlint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is a curried factory call, not an un-new-ed error constructor
			export class NotFound extends Schema.TaggedError<NotFound>()('NotFound', {
				id: Schema.String
			}) {}
		`
  )

  rule.valid(
    'allows a Class member on another namespace',
    `
			import { Domain } from './domain.ts'

			export class Widget extends Domain.Class('Widget') {}
		`
  )

  rule.invalid(
    'reports Schema.Class in an extends clause',
    `
			import { Schema } from 'effect'

			export class User extends Schema.Class<User>('User')({ name: Schema.String }) {}
		`,
    (messages) => {
      assert.match(messages, /Avoid Schema\.Class and Schema\.TaggedClass/)
      assert.match(messages, /Schema\.Struct or Schema\.TaggedStruct/)
    }
  )

  rule.invalid(
    'reports Schema.TaggedClass in an extends clause',
    `
			import { Schema } from 'effect'

			export class Created extends Schema.TaggedClass<Created>()('Created', {
				id: Schema.String
			}) {}
		`
  )

  rule.invalid(
    'reports a Schema.Class call outside an extends clause',
    `
			import { Schema } from 'effect'

			export const makeUser = Schema.Class('User')
		`
  )
})
