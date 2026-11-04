import { describe } from 'vite-plus/test'
import { createRuleHarness } from '../../test/harness.ts'

// Failure modes: aliases, subpaths, computed static members and extracted
// runners bypass enforcement; shadowed imports and composition get false positives.
const { valid, invalid } = createRuleHarness('starter/no-runtime-execution')

describe('runtime execution placement', () => {
  for (const runner of [
    'runSync',
    'runSyncExit',
    'runSyncWith',
    'runSyncExitWith',
    'runFork',
    'runForkWith',
    'runCallback',
    'runCallbackWith'
  ]) {
    invalid(
      `rejects Effect.${runner}`,
      `import { Effect as E } from 'effect'; E.${runner}(program)`
    )
  }
  invalid(
    'rejects subpath namespace runner extraction',
    `import * as E from 'effect/Effect'; const run = E['runFork']`
  )
  invalid(
    'rejects named subpath runner imports',
    `import { runSync as execute } from 'effect/Effect'; execute(program)`
  )
  invalid(
    'rejects managed runtime construction',
    `import { ManagedRuntime as M } from 'effect'; M.make(layer)`
  )
  invalid(
    'rejects subpath managed runtime construction',
    `import * as M from 'effect/ManagedRuntime'; M.make(layer)`
  )
  invalid(
    'rejects root namespace access',
    `import * as Fx from 'effect'; Fx.Effect.runSync(program)`
  )
  invalid(
    'rejects named managed constructor imports',
    `import { make } from 'effect/ManagedRuntime'; make(layer)`
  )
  for (const runner of ['runSync', 'runSyncExit', 'runFork', 'runCallback']) {
    invalid(`rejects application runtime ${runner}`, `webRuntime.${runner}(program)`)
    invalid(`rejects instance runtime ${runner}`, `this.runtime.${runner}(program)`)
  }
  valid('allows unrelated runner methods', `scheduler.runSync(task)`)
  valid(
    'leaves promises to the existing Effect rule',
    `import { Effect } from 'effect'; Effect.runPromise(program)`
  )
  valid(
    'allows scoped composition',
    `import { Effect } from 'effect'; Effect.forkScoped(program)`
  )
  valid(
    'allows shadowed imports',
    `import { Effect } from 'effect'; function f(Effect) { Effect.runSync(program) }`
  )
  valid(
    'allows unrelated objects',
    `const ManagedRuntime = { make: () => 1 }; ManagedRuntime.make()`
  )
  valid(
    'allows type imports',
    `import type { ManagedRuntime } from 'effect'; type R = ManagedRuntime.ManagedRuntime<Service>`
  )
})
