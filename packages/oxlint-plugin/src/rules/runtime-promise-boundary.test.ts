import { describe } from 'vite-plus/test'
import { createRuleHarness } from '../../test/harness.ts'

// Probe the installed rule before duplicating its Promise-edge detection.
const { valid, invalid } = createRuleHarness('effect/noRunPromise')

describe('existing Promise execution enforcement', () => {
  for (const runner of [
    'runPromise',
    'runPromiseExit',
    'runPromiseWith',
    'runPromiseExitWith'
  ]) {
    invalid(
      `rejects ${runner}`,
      `import { Effect as E } from 'effect'; E.${runner}(program)`
    )
  }
  invalid('rejects runtime promise methods', `runtime.runPromise(program)`)
  invalid(
    'rejects named application runtime methods',
    `webRuntime.runPromiseExit(program)`
  )
  invalid(
    'rejects namespace imports',
    `import * as E from 'effect/Effect'; E.runPromise(program)`
  )
  valid(
    'allows Effect composition',
    `import { Effect } from 'effect'; Effect.flatMap(first, second)`
  )
  valid(
    'leaves synchronous execution to the starter rule',
    `import { Effect } from 'effect'; Effect.runSync(program)`
  )
  valid(
    'leaves managed construction to the starter rule',
    `import { ManagedRuntime } from 'effect'; ManagedRuntime.make(layer)`
  )
  valid(
    'leaves test policy to the test rule',
    `import { Effect } from 'effect'; Effect.runPromise(program)`,
    { filename: 'boundary.test.ts' }
  )
})
