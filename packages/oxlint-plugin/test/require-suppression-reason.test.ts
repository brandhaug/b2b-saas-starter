import { describe } from 'vite-plus/test'
import { createRuleHarness } from './harness.ts'

describe('require-suppression-reason', () => {
  const { valid, invalid } = createRuleHarness('starter/require-suppression-reason')
  for (const directive of [
    'oxlint-disable',
    'eslint-disable-next-line',
    'oxlint-disable-line'
  ]) {
    invalid(`missing: ${directive}`, `// ${directive} no-console\nconsole.log(1)`)
    invalid(`empty: ${directive}`, `// ${directive} no-console -- \nconsole.log(1)`)
    invalid(`token: ${directive}`, `// ${directive} no-console -- TODO\nconsole.log(1)`)
    valid(
      `inline: ${directive}`,
      `// ${directive} no-console -- CLI output is the command result\nconsole.log(1)`
    )
  }
  valid(
    'preceding prose',
    '// CLI output is the command result\n// oxlint-disable-next-line no-console\nconsole.log(1)'
  )
  valid(
    'following prose',
    '// oxlint-disable no-console\n// CLI output is the command result\nconsole.log(1)'
  )
  valid(
    'stacked directives',
    '// CLI output is the command result\n// oxlint-disable no-console\n// oxlint-disable no-alert\nconsole.log(1)'
  )
  valid(
    'multiline explanation',
    '/* oxlint-disable no-console\n * -- CLI output is the command result\n */\nconsole.log(1)'
  )
  valid(
    'enable and TypeScript delegated',
    '// oxlint-enable no-console\n// @ts-expect-error\nfoo()'
  )
  invalid(
    'blank line breaks adjacency',
    '// CLI output is the command result\n\n// oxlint-disable no-console\nconsole.log(1)'
  )
  invalid(
    'code breaks adjacency',
    '// CLI output is the command result\nfoo()\n// oxlint-disable no-console\nconsole.log(1)'
  )
  invalid(
    'JSX directive',
    'const x = <div>{/* eslint-disable-next-line no-console */}{foo()}</div>',
    undefined,
    { filename: 'fixture.tsx' }
  )
  valid('directive text in string', "const x = 'oxlint-disable no-console'")
  invalid(
    'enable directive is not prose',
    '// oxlint-enable no-console\n// oxlint-disable no-console\nconsole.log(1)'
  )
  invalid(
    'TypeScript directive is not prose',
    '// @ts-expect-error known type boundary\n// oxlint-disable no-console\nconsole.log(1)'
  )
})
