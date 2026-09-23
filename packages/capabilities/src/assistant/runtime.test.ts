import { expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { makeConversationHostLayer } from './runtime.ts'
import { AssistantDirectory } from './directory.ts'

it.effect('refuses a native conversation host without D1', () =>
  Effect.gen(function* () {
    const failure = yield* Effect.flip(
      Effect.gen(function* () {
        return yield* AssistantDirectory
      }).pipe(Effect.provide(makeConversationHostLayer({})))
    )
    expect(failure).toMatchObject({
      _tag: 'ConversationUnavailable',
      reason: 'configuration'
    })
  })
)
