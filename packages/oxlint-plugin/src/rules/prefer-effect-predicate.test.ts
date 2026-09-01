import { assert, describe } from 'vite-plus/test'
import { createRuleHarness } from '../../test/harness.ts'

const rule = createRuleHarness('starter/prefer-effect-predicate')

describe('starter/prefer-effect-predicate', () => {
  rule.valid(
    'allows the Effect predicates',
    `
			import { Predicate } from 'effect'

			export const names = ['a', null].filter(Predicate.isNotNull)
		`
  )

  rule.valid(
    'allows nullish comparisons in files that do not import effect',
    `
			export const isPresent = (value: string | null) => value !== null
		`
  )

  rule.valid(
    'allows comparisons that are not against the single parameter',
    `
			import { Predicate } from 'effect'

			export const hasName = (user: { name: string | null }) => user.name !== null

			export const both = (left: string | null, right: string | null) =>
				left !== null && right !== null

			export const isEmpty = (value: string) => value === ''

			export const kept = Predicate.isNotNullable
		`
  )

  rule.invalid(
    'reports an arrow predicate bound to a const',
    `
			import { Predicate } from 'effect'

			export const isPresent = (value: string | null) => value !== null

			export const kept = Predicate.isNotNullable
		`,
    (messages) => {
      assert.match(messages, /Avoid hand-written nullish predicates/)
      assert.match(messages, /Predicate\.isNotNull or Predicate\.isNotNullable/)
    }
  )

  rule.invalid(
    'reports an inline predicate in filter',
    `
			import { Predicate } from 'effect'

			const items: readonly (string | undefined)[] = ['a', undefined]

			export const names = items.filter((item) => item !== undefined)

			export const kept = Predicate.isNotNullable
		`
  )

  rule.invalid(
    'reports a function declaration predicate',
    `
			import { Predicate } from 'effect'

			export function isPresent(value: string | null) {
				return null !== value
			}

			export const kept = Predicate.isNotNullable
		`
  )
})
