import { assert, describe } from 'vite-plus/test'
import { createRuleHarness } from '../../test/harness.ts'

// Failure modes: each service-implementation shape (curried and data-first
// Layer.effect/Layer.succeed, Tag.of with a literal or local, a same-file make
// constant), each untraced operation shape (Effect-valued gen, arrow, block,
// function expression, method, piped gen, same-file helper), aliased and
// namespace imports. Quiet cases: wrapped operations, plain data, non-gen
// operations, inline programs inside an operation, the Layer's own
// construction generator, nested data objects, unrelated or shadowed modules.
describe('named-service-operation', () => {
  const { valid, invalid } = createRuleHarness('starter/named-service-operation')

  const header = `import { Effect, Layer } from 'effect'
import { Feed } from './feed'
`

  invalid(
    'Effect-valued operation in a Layer.effect generator',
    `${header}
export const LiveFeed = Layer.effect(Feed)(
  Effect.gen(function* () {
    return { list: Effect.gen(function* () { return [] }) }
  })
)`,
    (messages) => {
      assert.include(messages, "Effect.fn('Feed.list')")
      assert.include(messages, '})()')
    }
  )
  invalid(
    'arrow thunk in a Layer.effect generator',
    `${header}
export function LiveFeed() {
  return Layer.effect(Feed)(
    Effect.gen(function* () {
      const db = yield* Database
      return { create: (input) => Effect.gen(function* () { return input }) }
    })
  )
}`,
    (messages) => {
      assert.include(messages, "Effect.fn('Feed.create')")
    }
  )
  invalid(
    'data-first Layer.effect',
    `${header}
export const LiveFeed = Layer.effect(
  Feed,
  Effect.gen(function* () {
    return { create: (input) => Effect.gen(function* () { return input }) }
  })
)`
  )
  invalid(
    'Tag.of in a Seed factory',
    `${header}
export function SeedFeed(state) {
  return Feed.of({ read: (id) => Effect.gen(function* () { return state.get(id) }) })
}`
  )
  invalid(
    'Tag.of with a same-file implementation constant',
    `${header}
export function SeedFeed(state) {
  const service = { read: (id) => Effect.gen(function* () { return state.get(id) }) }
  return Feed.of(service)
}`,
    (messages) => {
      assert.include(messages, "Effect.fn('Feed.read')")
    }
  )
  invalid(
    'a trailing Service drops from the suggested label',
    `import { Effect } from 'effect'
import { FeedService } from './feed'
export const SeedFeed = FeedService.of({ read: () => Effect.gen(function* () {}) })`,
    (messages) => {
      assert.include(messages, "Effect.fn('Feed.read')")
    }
  )
  invalid(
    'curried Layer.succeed',
    `${header}
export const SeedFeed = Layer.succeed(Feed)({ read: () => Effect.gen(function* () {}) })`
  )
  invalid(
    'data-first Layer.succeed',
    `${header}
export const SeedFeed = Layer.succeed(Feed, { read: () => Effect.gen(function* () {}) })`
  )
  invalid(
    'block body returning a generator',
    `${header}
export const SeedFeed = Feed.of({
  read: (id) => {
    const key = String(id)
    return Effect.gen(function* () { return key })
  }
})`
  )
  invalid(
    'function expression',
    `${header}
export const SeedFeed = Feed.of({
  read: function (id) { return Effect.gen(function* () { return id }) }
})`
  )
  invalid(
    'method shorthand',
    `${header}
export const SeedFeed = Feed.of({
  read(id) { return Effect.gen(function* () { return id }) }
})`
  )
  invalid(
    'piped generator',
    `${header}
export const SeedFeed = Feed.of({
  read: (id) => Effect.gen(function* () { return id }).pipe(Effect.orElseSucceed(() => null))
})`
  )
  invalid(
    'same-file make constant',
    `${header}
const make = Effect.gen(function* () {
  return { read: (id) => Effect.gen(function* () { return id }) }
})
export const LiveFeed = Layer.effect(Feed)(make)`
  )
  invalid(
    'same-file helper referenced by shorthand',
    `${header}
export const LiveFeed = Layer.effect(Feed)(
  Effect.gen(function* () {
    const read = (id) => Effect.gen(function* () { return id })
    return { read }
  })
)`,
    (messages) => {
      assert.include(messages, "Effect.fn('Feed.read')")
    }
  )
  invalid(
    'aliased and namespace imports',
    `import * as E from 'effect/Effect'
import { Layer as L } from 'effect'
import { Feed } from './feed'
export const LiveFeed = L.effect(Feed)(
  E.gen(function* () {
    return { read: (id) => E.gen(function* () { return id }) }
  })
)`
  )

  valid(
    'named operations, Effect-valued and function-valued',
    `${header}
export const LiveFeed = Layer.effect(Feed)(
  Effect.gen(function* () {
    const prepare = Effect.fn('Feed.prepare')(function* (input) { return input })
    return {
      list: Effect.fn('Feed.list')(function* () { return [] })(),
      read: Effect.fn('Feed.read')((id) => Effect.succeed(id)),
      prepare
    }
  })
)`
  )
  valid(
    'plain data, constants and non-generator operations',
    `${header}
export const SeedFeed = Feed.of({
  name: 'feed',
  limit: 10,
  items: [],
  ready: Effect.void,
  first: Effect.succeed(1),
  get: (id) => store.get(id),
  count: () => Effect.succeed(0)
})`
  )
  valid(
    'inline programs inside a named operation',
    `${header}
export const LiveFeed = Layer.effect(Feed)(
  Effect.gen(function* () {
    return {
      prepare: Effect.fn('Feed.prepare')(function* (input) {
        return { publish: Effect.gen(function* () { return input }) }
      })
    }
  })
)`
  )
  valid(
    'objects returned from nested callbacks are data',
    `${header}
export const LiveFeed = Layer.effect(Feed)(
  Effect.gen(function* () {
    const rows = [1, 2].map((row) => {
      return { publish: Effect.gen(function* () { return row }) }
    })
    return Feed.of({ rows: Effect.fn('Feed.rows')(function* () { return rows })() })
  })
)`
  )
  valid(
    'objects outside a service implementation',
    `import { Effect } from 'effect'
export function prepare(input) {
  return { publish: Effect.gen(function* () { return input }), commit: () => Effect.gen(function* () {}) }
}`
  )
  valid(
    'global .of',
    `import { Effect } from 'effect'
export const items = Array.of({ read: () => Effect.gen(function* () {}) })`
  )
  valid(
    'unrelated Layer and Effect modules',
    `import { Effect, Layer } from './other'
import { Feed } from './feed'
export const LiveFeed = Layer.succeed(Feed)({ read: () => Effect.gen(function* () {}) })`
  )
  valid(
    'shadowed Effect',
    `import { Layer } from 'effect'
import { Feed } from './feed'
export function build(Effect) {
  return Layer.succeed(Feed)({ read: () => Effect.gen(function* () {}) })
}`
  )
  valid(
    'generator already piped through withSpan',
    `${header}
export const SeedFeed = Feed.of({
  read: (id) => Effect.gen(function* () { return id }).pipe(Effect.withSpan('Feed.read'))
})`
  )
  valid(
    'documented untraced operation',
    `${header}
export const SeedFeed = Feed.of({
  // oxlint-disable-next-line starter/named-effect-operation -- per-event helper runs within the caller's span
  read: Effect.fnUntraced(function* (id) { return id })
})`
  )
})
