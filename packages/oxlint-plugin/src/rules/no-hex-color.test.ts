import { assert, describe } from 'vite-plus/test'
import { createRuleHarness } from '../../test/harness.ts'

const rule = createRuleHarness('starter/no-hex-color')

describe('starter/no-hex-color', () => {
  rule.valid(
    'allows semantic token references',
    `export const accent = 'var(--chart-1)'`
  )

  rule.valid(
    'allows strings that are not hex colors',
    `export const label = '#1 in the release notes'`
  )

  rule.valid(
    'allows short strings a substring probe would misdetect',
    `export const markdown = 'read the #faq section'`
  )

  rule.invalid(
    'reports a six-digit hex color',
    `export const accent = '#89b4fa'`,
    (messages) => {
      assert.match(messages, /Raw color '#89b4fa'/)
      assert.match(messages, /apps\/web\/src\/index\.css/)
    }
  )

  rule.invalid(
    'reports a four-digit hex color with surrounding whitespace',
    `export const accent = ' #fff '`
  )

  rule.invalid(
    'reports an eight-digit hex color with alpha',
    `export const overlay = '#11111be6'`
  )
})
