import { expect, it } from '@effect/vitest'
import { TestClock } from 'effect/testing'
import { Effect, Stream, Layer, Deferred } from 'effect'
import {
  ConversationModel,
  type ConversationModelEvent
} from '@b2b-saas-starter/ai/conversation'
import { prepareConversationContext } from '@b2b-saas-starter/ai/conversation-context'
import { AssistantConversations } from './assistant-conversations.ts'
import { AssistantDirectory } from '../assistant/directory.ts'
import { makeSeedCapabilitiesLayer } from '../layers.ts'
import { WorkspaceContext } from '../workspace-context.ts'
import {
  modelLimits,
  credential,
  workspace
} from './assistant-conversation.seed-fixture.ts'

it.effect(
  'an idle Seed run survives credential invalidation but observes an interrupting revision within fifteen seconds',
  () =>
    Effect.gen(function* () {
      const saved = yield* Deferred.make<undefined>()
      let calls = 0
      const model = ConversationModel.of({
        prepare: (input) => prepareConversationContext(input, modelLimits),
        stream: () => {
          calls += 1
          return Stream.succeed({
            type: 'text-delta',
            text: 'Idle saved prefix'
          } satisfies ConversationModelEvent).pipe(
            Stream.concat(
              Stream.fromEffect(Deferred.succeed(saved, undefined)).pipe(Stream.drain)
            ),
            Stream.concat(Stream.never)
          )
        }
      })
      yield* Effect.gen(function* () {
        const conversations = yield* AssistantConversations
        const directory = yield* AssistantDirectory
        const created = yield* conversations.create({ credential })
        const identity = { credential, conversationId: created.id }
        yield* conversations.send({
          ...identity,
          question: 'Keep running without observers',
          idempotencyKey: 'idle'
        })
        yield* Deferred.await(saved)
        yield* directory.invalidateAccess({ conversationId: created.id })
        yield* TestClock.adjust('15 seconds')
        expect(
          (yield* conversations.history(identity)).items[0]?.attempts[0]
        ).toMatchObject({ status: 'Running', text: 'Idle saved prefix' })
        yield* directory.invalidateAccess(
          { conversationId: created.id },
          { interruptRuns: true }
        )
        yield* directory.invalidateAccess(
          { conversationId: created.id },
          { interruptRuns: true }
        )
        yield* TestClock.adjust('15 seconds')
        expect(
          (yield* conversations.history(identity)).items[0]?.attempts[0]
        ).toMatchObject({
          status: 'Interrupted',
          reason: 'authority',
          text: 'Idle saved prefix'
        })
        expect(calls).toBe(1)
      }).pipe(
        Effect.provide(
          makeSeedCapabilitiesLayer({
            conversationModel: Layer.succeed(ConversationModel, model)
          })
        )
      )
    }).pipe(Effect.provideService(WorkspaceContext, workspace)),
  20_000
)

it.effect(
  'the shared execution deadline retains partial text and provider metadata',
  () =>
    Effect.gen(function* () {
      const ready = yield* Deferred.make<undefined>()
      const model = ConversationModel.of({
        prepare: (input) => prepareConversationContext(input, modelLimits),
        stream: () =>
          Stream.make(
            {
              type: 'metadata',
              provider: 'mock',
              modelId: 'deadline-model',
              providerRequestId: 'deadline-request'
            } satisfies ConversationModelEvent,
            {
              type: 'text-delta',
              text: 'Saved before deadline'
            } satisfies ConversationModelEvent
          ).pipe(
            Stream.concat(
              Stream.fromEffect(Deferred.succeed(ready, undefined)).pipe(Stream.drain)
            ),
            Stream.concat(Stream.never)
          )
      })
      yield* Effect.gen(function* () {
        const conversations = yield* AssistantConversations
        const created = yield* conversations.create({ credential })
        const identity = { credential, conversationId: created.id }
        yield* conversations.send({
          ...identity,
          question: 'Wait for deadline',
          idempotencyKey: 'deadline'
        })
        yield* Deferred.await(ready)
        yield* TestClock.adjust('5 minutes')
        expect(
          (yield* conversations.history(identity)).items[0]?.attempts[0]
        ).toMatchObject({
          status: 'Interrupted',
          reason: 'deadline_or_stop',
          text: 'Saved before deadline',
          provider: 'mock',
          modelId: 'deadline-model',
          providerRequestId: 'deadline-request'
        })
      }).pipe(
        Effect.provide(
          makeSeedCapabilitiesLayer({
            conversationModel: Layer.succeed(ConversationModel, model)
          })
        )
      )
    }).pipe(Effect.provideService(WorkspaceContext, workspace))
)
