import { assert, describe } from 'vite-plus/test'
import { createRuleHarness } from '../../test/harness.ts'

describe('no-nested-service-yield', () => {
  const { valid, invalid } = createRuleHarness('starter/no-nested-service-yield')

  for (const call of [
    'Effect.gen',
    'Effect.fn',
    'Effect.fn("read")',
    'Effect.fnUntraced'
  ]) {
    invalid(
      `nested receiver in ${call}`,
      `
      import { Effect } from 'effect'
      const read = ${call}(function* () {
        return yield* (yield* Service).read()
      })
    `,
      (messages) => assert.include(messages, 'const service = yield* Service')
    )
  }

  invalid(
    'aliased import and namespaced service',
    `
    import { Effect as Fx } from 'effect'
    Fx.gen(function* () { yield* (yield* Services.Store)['read']() })
  `
  )
  invalid(
    'submodule namespace import',
    `
    import * as Fx from 'effect/Effect'
    Fx.gen(function* () { yield* (yield* Store).read() })
  `
  )
  invalid(
    'computed generator name',
    `
    import { Effect } from 'effect'
    Effect['gen'](function* () { yield* (yield* Store).read() })
  `
  )
  valid(
    'factory result receiver may be a collection',
    `
    import { Effect } from 'effect'
    Effect.gen(function* () { yield* (yield* makeStore()).read() })
  `
  )
  valid(
    'searching a yielded reservation collection',
    `
    import { Effect } from 'effect'
    Effect.gen(function* () {
      const reservation = (yield* host.reservations()).find(row => row.id === id)
      return reservation
    })
  `
  )
  valid(
    'separate binding',
    `
    import { Effect } from 'effect'
    Effect.gen(function* () { const store = yield* Store; return yield* store.read() })
  `
  )
  valid(
    'yielded value effect is not a service reference',
    `
    import { Effect } from 'effect'
    Effect.gen(function* () { return (yield* Clock.currentTimeMillis).toFixed(0) })
  `
  )
  valid(
    'local effect result is not a service reference',
    `
    import { Effect } from 'effect'
    Effect.gen(function* () { return (yield* reservations).find(row => row.id === id) })
  `
  )
  valid(
    'native generator',
    `
    function* values() { yield* (yield* items).entries() }
  `
  )
  valid(
    'nested native generator',
    `
    import { Effect } from 'effect'
    Effect.gen(function* () {
      function* values() { yield* (yield* items).entries() }
      return values
    })
  `
  )
  valid(
    'unrelated Effect object',
    `
    const Effect = customGenerator
    Effect.gen(function* () { yield* (yield* items).entries() })
  `
  )
  valid(
    'shadowed import parameter',
    `
    import { Effect } from 'effect'
    function read(Effect) {
      return Effect.gen(function* () { yield* (yield* items).entries() })
    }
  `
  )
  valid(
    'shadowed import block',
    `
    import { Effect } from 'effect'
    { const Effect = customGenerator
      Effect.gen(function* () { yield* (yield* items).entries() })
    }
  `
  )
  valid(
    'root namespace is not Effect namespace',
    `
    import * as Effect from 'effect'
    Effect.gen(function* () { yield* (yield* items).entries() })
  `
  )
  valid(
    'nondelegated yield',
    `
    import { Effect } from 'effect'
    Effect.gen(function* () { yield* (yield Store).read() })
  `
  )
  valid(
    'type-only import',
    `
    import type { Effect } from 'effect'
    Effect.gen(function* () { yield* (yield* Store).read() })
  `
  )
  valid(
    'inline type-only import',
    `
    import { type Effect } from 'effect'
    Effect.gen(function* () { yield* (yield* Store).read() })
  `
  )
  valid(
    'dynamic method is not statically identified',
    `
    import { Effect } from 'effect'
    Effect[gen](function* () { yield* (yield* items).entries() })
  `
  )
  valid(
    'indirect callback',
    `
    import { Effect } from 'effect'
    function* read() { yield* (yield* items).entries() }
    Effect.gen(read)
  `
  )
})
