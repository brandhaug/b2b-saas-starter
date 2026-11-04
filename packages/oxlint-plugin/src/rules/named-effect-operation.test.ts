import { describe } from 'vite-plus/test'
import { createRuleHarness } from '../../test/harness.ts'

// Failure modes: missing/dynamic labels, import aliases and computed members,
// shadowed/unrelated APIs, explicit untraced exceptions, and duplicate reports
// on the outer curried call. These fixtures run against the real lint binary.
describe('named-effect-operation', () => {
  const { valid, invalid } = createRuleHarness('starter/named-effect-operation')

  invalid(
    'unnamed generator',
    `import { Effect } from 'effect'; Effect.fn(function* () {})`
  )
  invalid(
    'unnamed callback',
    `import { Effect } from 'effect'; Effect.fn(() => Effect.void)`
  )
  invalid(
    'dynamic label',
    `import { Effect } from 'effect'; Effect.fn(name)(function* () {})`
  )
  invalid(
    'interpolated label',
    // oxlint-disable-next-line no-template-curly-in-string -- the fixture must contain interpolation for the parser under test
    'import { Effect } from "effect"; Effect.fn(`Store.${id}`)(function* () {})'
  )
  invalid(
    'empty label',
    `import { Effect } from 'effect'; Effect.fn('')(function* () {})`
  )
  invalid(
    'untraced requires a reason',
    `import { Effect } from 'effect'; Effect.fnUntraced(function* () {})`
  )
  invalid(
    'aliased import',
    `import { Effect as E } from 'effect'; E.fn(name)(function* () {})`
  )
  invalid(
    'namespace import and computed member',
    `import * as E from 'effect/Effect'; E['fnUntraced'](function* () {})`
  )
  invalid(
    'computed unnamed callback',
    `import { Effect } from 'effect'; Effect['fn'](function* () {})`
  )

  valid(
    'named generator and options',
    `import { Effect } from 'effect'; Effect.fn('Store.read', { attributes: { kind: 'read' } })(function* () {})`
  )
  valid(
    'static template',
    'import { Effect } from "effect"; Effect.fn(`Store.read`)(function* () {})'
  )
  valid(
    'existing label is preserved',
    `import { Effect } from 'effect'; Effect.fn('legacy-operation')(function* () {})`
  )
  valid(
    'unrelated import',
    `import { Effect } from './other'; Effect.fn(function* () {})`
  )
  valid(
    'shadowed import',
    `import { Effect } from 'effect'; function run(Effect) { return Effect.fn(function* () {}) }`
  )
  valid('local object', `const Effect = { fn: f => f }; Effect.fn(function* () {})`)
  valid(
    'inline program',
    `import { Effect } from 'effect'; Effect.gen(function* () {})`
  )
  valid(
    'documented lightweight helper',
    `import { Effect } from 'effect';
// oxlint-disable-next-line starter/named-effect-operation -- per-row clock/id helper runs within the mutation span
Effect.fnUntraced(function* () {})`
  )
})
