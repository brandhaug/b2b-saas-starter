import { assert, describe } from 'vite-plus/test'
import { createRuleHarness } from '../../test/harness.ts'

const rule = createRuleHarness('starter/no-dark-prefix')

describe('starter/no-dark-prefix', () => {
  rule.valid(
    'allows semantic token classes without a variant',
    `export const classes = 'grid gap-4 rounded-none border border-border bg-card'`
  )

  rule.valid(
    'allows template literals that build classes without the variant',
    `
			export function size(n: number): string {
				return \`grid gap-\${n} bg-muted\`
			}
		`
  )

  rule.valid(
    'allows prose that is not a string literal to mention the variant',
    `// A stray dark: variant in a comment is not a class string.
			export const note = 'always dark'`
  )

  rule.invalid(
    'reports a dark: variant inside a class string',
    `export const classes = 'rounded-md bg-background dark:bg-black'`,
    (messages) => {
      assert.match(messages, /Remove the 'dark:' variant/)
      assert.match(messages, /DESIGN\.md/)
    }
  )

  rule.invalid(
    'reports a dark: variant in a template literal',
    'export const classes = `flex dark:flex-col`'
  )

  rule.invalid(
    'reports the arbitrary-value form of the variant',
    `export const classes = 'dark:[color-scheme:dark]'`
  )
})
