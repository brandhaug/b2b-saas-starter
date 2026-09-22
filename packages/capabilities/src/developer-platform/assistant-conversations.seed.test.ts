import { expect, it } from '@effect/vitest'
import { Effect, Schedule, Queue, Stream, Layer, Clock, Schema } from 'effect'
import {
  ConversationModel,
  ConversationModelFailure,
  type ConversationModelEvent,
  MockConversationModelLayer
} from '@b2b-saas-starter/ai/conversation'
import {
  ConversationInputRejected,
  prepareConversationContext,
  type ConversationPrompt
} from '@b2b-saas-starter/ai/conversation-context'
import {
  AssistantConversations,
  AssistantConversationsLayer
} from './assistant-conversations.ts'
import { conversationObservationContract } from './assistant-conversation-observation.contract.ts'
import { makeSeedAssistantConversationHost } from './assistant-conversations.seed.ts'
import { AssistantConversationLifecycle } from '../assistant/lifecycle.ts'
import { AssistantDirectory } from '../assistant/directory.ts'
import { SeedLayer, makeSeedCapabilitiesLayer } from '../layers.ts'
import { seedWorkspaceRecord } from '../seed-fixture.ts'
import {
  modelLimits,
  credential,
  workspace
} from './assistant-conversation.seed-fixture.ts'
import { WorkspaceContext } from '../workspace-context.ts'

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Json))

it.live(
  'assembled Seed can browse, export and delete while unconfigured generation accepts nothing',
  () =>
    Effect.gen(function* () {
      const conversations = yield* AssistantConversations
      const lifecycle = yield* AssistantConversationLifecycle
      const directory = yield* AssistantDirectory
      const created = yield* conversations.create({ credential })
      const identity = { credential, conversationId: created.id }
      expect(yield* conversations.read(identity)).toEqual(created)
      expect((yield* conversations.list({ credential })).items).toEqual([created])
      expect((yield* conversations.history(identity)).items).toEqual([])
      expect(
        yield* conversations
          .send({ ...identity, question: 'Hello', idempotencyKey: 'first' })
          .pipe(Effect.flip)
      ).toMatchObject({ _tag: 'ConversationUnavailable', reason: 'configuration' })
      expect((yield* conversations.history(identity)).items).toEqual([])
      const exported = yield* lifecycle.collectForExport(
        credential.userId,
        credential.sessionId
      )
      expect(exported.conversations).toHaveLength(1)
      yield* lifecycle.validateExport(
        credential.userId,
        credential.sessionId,
        exported.manifest
      )
      yield* directory.invalidateAccess({ conversationId: created.id })
      expect(
        (yield* lifecycle
          .validateExport(credential.userId, credential.sessionId, exported.manifest)
          .pipe(Effect.flip)).reason
      ).toBe('conversation_manifest_stale')
      expect(
        (yield* conversations
          .read({ ...identity, credential: { ...credential, userId: 'another-user' } })
          .pipe(Effect.flip))._tag
      ).toBe('ConversationNotFound')
      yield* conversations.remove(identity)
      expect((yield* conversations.list({ credential })).items).toEqual([])
      expect((yield* conversations.history(identity).pipe(Effect.flip))._tag).toBe(
        'ConversationNotFound'
      )
      expect(yield* lifecycle.cleanup()).toBe(1)
      expect((yield* directory.get(created.id))?.cleanedAt).not.toBeNull()
    }).pipe(
      Effect.provideService(WorkspaceContext, workspace),
      Effect.provide(SeedLayer)
    ),
  20_000
)

it.live(
  'explicit synthetic Seed generation keeps saved exchanges and joins idempotent deliveries',
  () =>
    Effect.gen(function* () {
      const conversations = yield* AssistantConversations
      const lifecycle = yield* AssistantConversationLifecycle
      const created = yield* conversations.create({ credential })
      const identity = { credential, conversationId: created.id }
      const input = {
        ...identity,
        question: 'Explain the workspace',
        idempotencyKey: 'first'
      }
      const accepted = yield* conversations.send(input)
      const completed = yield* conversations.history(identity).pipe(
        Effect.repeat({
          while: (page) => page.items[0]?.attempts[0]?.status !== 'Completed',
          schedule: Schedule.spaced('5 millis')
        }),
        Effect.timeout('5 seconds')
      )
      expect(completed.items[0]?.attempts[0]?.text.length).toBeGreaterThan(0)
      expect((yield* conversations.send(input)).attempt.id).toBe(accepted.attempt.id)
      expect(
        (yield* conversations
          .send({ ...input, question: 'Different' })
          .pipe(Effect.flip))._tag
      ).toBe('ConversationConflict')
      const observation = yield* conversations.observe({
        ...identity,
        attemptId: accepted.attempt.id,
        lastEventId: 'expired'
      })
      expect(yield* Effect.promise(() => observation.text())).toContain(
        'event: snapshot'
      )
      yield* conversationObservationContract({
        conversationId: created.id,
        history: completed,
        observe: (lastEventId) =>
          conversations.observe({
            ...identity,
            attemptId: accepted.attempt.id,
            lastEventId
          }),
        expect
      })
      expect(
        (yield* lifecycle.collectForExport(credential.userId, credential.sessionId))
          .conversations
      ).toHaveLength(1)
      expect(
        (yield* conversations.stop({ ...identity, attemptId: accepted.attempt.id }))
          .status
      ).toBe('Completed')
      expect(
        (yield* conversations
          .retry({
            ...identity,
            attemptId: accepted.attempt.id,
            idempotencyKey: 'retry-completed'
          })
          .pipe(Effect.flip))._tag
      ).toBe('ConversationConflict')
    }).pipe(
      Effect.provideService(WorkspaceContext, workspace),
      Effect.provide(
        makeSeedCapabilitiesLayer({ conversationModel: MockConversationModelLayer })
      )
    ),
  20_000
)

it.live(
  'explicit Seed runs share quota, Stop releases a slot, and Retry retains its question',
  () =>
    Effect.gen(function* () {
      const started = yield* Queue.unbounded<string>()
      let ended = 0
      const model = ConversationModel.of({
        prepare: (input) => prepareConversationContext(input, modelLimits),
        stream: () =>
          Stream.fromEffect(Queue.offer(started, 'started')).pipe(
            Stream.flatMap(() => Stream.never),
            Stream.ensuring(
              Effect.sync(() => {
                ended += 1
              })
            )
          )
      })
      yield* Effect.gen(function* () {
        const conversations = yield* AssistantConversations
        const lifecycle = yield* AssistantConversationLifecycle
        const created = yield* Effect.forEach([1, 2, 3, 4], () =>
          conversations.create({ credential })
        )
        const identities = created.map((row) => ({
          credential,
          conversationId: row.id
        }))
        const first = identities[0]
        const second = identities[1]
        const fourth = identities[3]
        if (first === undefined || second === undefined || fourth === undefined) {
          return yield* Effect.die('Fixture conversations are absent.')
        }
        const accepted = yield* Effect.forEach(identities.slice(0, 3), (identity) =>
          conversations.send({
            ...identity,
            question: 'Held answer',
            idempotencyKey: 'send'
          })
        )
        yield* Effect.forEach([1, 2, 3], () => Queue.take(started))
        const original = accepted[0]
        if (original === undefined) {
          return yield* Effect.die('Accepted attempt is absent.')
        }
        expect(
          yield* conversations
            .send({ ...fourth, question: 'Held answer', idempotencyKey: 'fourth' })
            .pipe(Effect.flip)
        ).toMatchObject({
          _tag: 'AssistantAdmissionRefused',
          reason: 'concurrency_limit'
        })
        expect(
          (yield* conversations.send({
            ...first,
            question: 'Held answer',
            idempotencyKey: 'send'
          })).attempt.id
        ).toBe(original.attempt.id)
        const events = yield* conversations.observe({
          ...first,
          attemptId: original.attempt.id
        })
        expect(
          (yield* conversations.stop({ ...first, attemptId: original.attempt.id }))
            .status
        ).toBe('Stopped')
        expect(yield* Effect.promise(() => events.text())).toContain('event: terminal')
        const retry = yield* conversations.retry({
          ...first,
          attemptId: original.attempt.id,
          idempotencyKey: 'retry'
        })
        yield* Queue.take(started)
        expect(retry.question.id).toBe(original.question.id)
        yield* conversations.stop({ ...first, attemptId: original.attempt.id })
        expect(ended).toBe(1)
        expect((yield* conversations.history(first)).items[0]?.attempts).toHaveLength(2)
        yield* conversations.remove(second)
        expect(yield* lifecycle.cleanup()).toBe(1)
        yield* conversations.send({
          ...fourth,
          question: 'Now admitted',
          idempotencyKey: 'fourth-after-delete'
        })
        yield* Queue.take(started)
        expect((yield* conversations.history(fourth)).items).toHaveLength(1)
      }).pipe(
        Effect.provideService(WorkspaceContext, workspace),
        Effect.provide(
          makeSeedCapabilitiesLayer({
            conversationModel: Layer.succeed(ConversationModel, model)
          })
        )
      )
    }),
  20_000
)

const retryFailures: ReadonlyArray<{
  reason: ConversationModelFailure['reason']
  observation: string
}> = [
  { reason: 'provider', observation: 'provider' },
  { reason: 'output-limit', observation: 'output_limit' }
]
for (const failure of retryFailures) {
  it.live(
    `explicit Seed retains ${failure.reason} partial output and retries with safe failure context`,
    () =>
      Effect.gen(function* () {
        let calls = 0
        const prompts: Array<ConversationPrompt> = []
        const model = ConversationModel.of({
          prepare: (input) => {
            prompts.push(input)
            return prepareConversationContext(input, modelLimits)
          },
          stream: () => {
            calls += 1
            if (calls === 1) {
              return Stream.concat(
                Stream.make({
                  type: 'text-delta',
                  text: 'Interrupted prefix'
                } satisfies ConversationModelEvent),
                Stream.fail(
                  new ConversationModelFailure({
                    reason: failure.reason,
                    message: 'Synthetic provider failure'
                  })
                )
              )
            }
            return Stream.make(
              {
                type: 'text-delta',
                text: 'Successful answer'
              } satisfies ConversationModelEvent,
              {
                type: 'finish',
                reason: 'stop',
                inputTokens: 10,
                outputTokens: 3
              } satisfies ConversationModelEvent
            )
          }
        })
        yield* Effect.gen(function* () {
          const conversations = yield* AssistantConversations
          const created = yield* conversations.create({ credential })
          const identity = { credential, conversationId: created.id }
          const first = yield* conversations.send({
            ...identity,
            question: 'First question',
            idempotencyKey: 'first'
          })
          const interrupted = yield* conversations.history(identity).pipe(
            Effect.repeat({
              while: (page) => page.items[0]?.attempts[0]?.status !== 'Interrupted',
              schedule: Schedule.spaced('5 millis')
            }),
            Effect.timeout('5 seconds')
          )
          expect(interrupted.items[0]?.attempts[0]?.text).toBe('Interrupted prefix')
          const retry = yield* conversations.retry({
            ...identity,
            attemptId: first.attempt.id,
            idempotencyKey: 'retry'
          })
          expect(retry.question.id).toBe(first.question.id)
          const completed = yield* conversations.history(identity).pipe(
            Effect.repeat({
              while: (page) => page.items[0]?.attempts[1]?.status !== 'Completed',
              schedule: Schedule.spaced('5 millis')
            }),
            Effect.timeout('5 seconds')
          )
          expect(completed.items[0]?.attempts[1]).toMatchObject({
            text: 'Successful answer',
            inputTokens: 10,
            outputTokens: 3
          })
          expect(prompts[1]?.history).toEqual([])
          expect(prompts[1]?.failureObservations).toEqual([
            {
              questionId: first.question.id,
              attemptId: first.attempt.id,
              reason: failure.observation
            }
          ])
          yield* conversations.send({
            ...identity,
            question: 'Follow up',
            idempotencyKey: 'follow-up'
          })
          expect(prompts[2]?.history).toEqual([
            {
              questionId: first.question.id,
              question: 'First question',
              answer: 'Successful answer'
            }
          ])
          yield* conversations.history(identity).pipe(
            Effect.repeat({
              while: (page) => page.items.at(-1)?.attempts[0]?.status !== 'Completed',
              schedule: Schedule.spaced('5 millis')
            }),
            Effect.timeout('5 seconds')
          )
          expect(calls).toBe(3)
        }).pipe(
          Effect.provideService(WorkspaceContext, workspace),
          Effect.provide(
            makeSeedCapabilitiesLayer({
              conversationModel: Layer.succeed(ConversationModel, model)
            })
          )
        )
      }),
    20_000
  )
}

it.live(
  'assembled Seed hides conversations after their evidence policy becomes unavailable',
  () =>
    Effect.gen(function* () {
      const conversations = yield* AssistantConversations
      const directory = yield* AssistantDirectory
      const lifecycle = yield* AssistantConversationLifecycle
      const visible = yield* conversations.create({ credential })
      const hidden = yield* conversations.create({ credential })
      const identity = { credential, conversationId: hidden.id }
      expect(
        (yield* conversations
          .read({ ...identity, credential: { ...credential, expiresAt: 0 } })
          .pipe(Effect.flip))._tag
      ).toBe('AssistantAuthorityDenied')
      expect(
        (yield* conversations
          .stop({ ...identity, attemptId: 'absent' })
          .pipe(Effect.flip))._tag
      ).toBe('ConversationNotFound')
      expect(
        (yield* conversations
          .observe({ ...identity, attemptId: 'absent' })
          .pipe(Effect.flip))._tag
      ).toBe('ConversationNotFound')
      expect(
        (yield* conversations
          .connect({ ...identity, request: new Request('https://web.test') })
          .pipe(Effect.flip))._tag
      ).toBe('ConversationUnavailable')
      yield* directory.raisePolicy(hidden.id, ['unknown:permission'])
      expect((yield* conversations.history(identity).pipe(Effect.flip))._tag).toBe(
        'ConversationNotFound'
      )
      expect(
        (yield* conversations.list({ credential })).items.map((item) => item.id)
      ).toEqual([visible.id])
      expect(
        (yield* lifecycle.collectForExport(credential.userId, credential.sessionId))
          .conversations
      ).toHaveLength(1)
      expect(
        (yield* conversations
          .read({
            ...identity,
            conversationId: visible.id,
            credential: { ...credential, sessionId: 'expired-session' }
          })
          .pipe(Effect.flip))._tag
      ).toBe('ConversationNotFound')
    }).pipe(
      Effect.provideService(WorkspaceContext, workspace),
      Effect.provide(SeedLayer)
    )
)

it.live(
  'the assembled capability fails closed for missing transport and untrusted host responses',
  () =>
    Effect.gen(function* () {
      const directory = yield* AssistantDirectory
      yield* directory.create({
        id: 'transport-failure',
        workspaceId: seedWorkspaceRecord.id,
        creatorUserId: credential.userId
      })
      const identity = { credential, conversationId: 'transport-failure' }
      const unavailable = yield* Effect.gen(function* () {
        return yield* (yield* AssistantConversations).read(identity).pipe(Effect.flip)
      }).pipe(Effect.provide(AssistantConversationsLayer()))
      expect(unavailable).toMatchObject({
        _tag: 'ConversationUnavailable',
        reason: 'configuration'
      })
      const responses = [
        () => Promise.reject(new Error('private storage detail')),
        () => Promise.resolve(new Response('private storage detail', { status: 503 })),
        () =>
          Promise.resolve(
            Response.json({ secret: 'private storage detail' }, { status: 503 })
          ),
        () => Promise.resolve(new Response('invalid JSON')),
        () => Promise.resolve(Response.json({ id: 'incomplete response' })),
        () =>
          Promise.resolve(
            Response.json(
              { _tag: 'ConversationInputRejected', reason: 'current_context_budget' },
              { status: 400 }
            )
          )
      ]
      for (const request of responses) {
        const failure = yield* Effect.gen(function* () {
          return yield* (yield* AssistantConversations).read(identity).pipe(Effect.flip)
        }).pipe(Effect.provide(AssistantConversationsLayer({ request })))
        expect(['ConversationUnavailable', 'ConversationInputRejected']).toContain(
          failure._tag
        )
        expect(String(failure)).not.toContain('private storage detail')
      }
    }).pipe(
      Effect.provideService(WorkspaceContext, workspace),
      Effect.provide(SeedLayer)
    )
)

it.live(
  'assembled Seed pages complete history without dropping older exchanges from exports',
  () => {
    let offset = 0
    return Effect.gen(function* () {
      const conversations = yield* AssistantConversations
      const lifecycle = yield* AssistantConversationLifecycle
      const created = yield* conversations.create({ credential })
      const identity = { credential, conversationId: created.id }
      for (let index = 0; index < 31; index++) {
        if (index === 20) {
          offset += 61_000
        }
        yield* conversations.send({
          ...identity,
          question: `A long initial question about workspace operations and retained assistant conversation history number ${index}`,
          idempotencyKey: `page-${index}`
        })
        yield* conversations.history(identity).pipe(
          Effect.repeat({
            while: (page) => page.items.at(-1)?.attempts.at(-1)?.status !== 'Completed',
            schedule: Schedule.spaced('1 millis')
          })
        )
      }
      const latest = yield* conversations.history(identity)
      expect(latest.items).toHaveLength(30)
      expect(latest.nextCursor).not.toBeNull()
      if (latest.nextCursor === null) {
        return yield* Effect.die('Expected an older page.')
      }
      const older = yield* conversations.history({
        ...identity,
        cursor: latest.nextCursor
      })
      expect(older.items).toHaveLength(1)
      expect(older.nextCursor).toBeNull()
      expect((yield* conversations.read(identity)).title?.length).toBeLessThanOrEqual(
        80
      )
      const exported = yield* lifecycle.collectForExport(
        credential.userId,
        credential.sessionId
      )
      expect(exported.conversations).toHaveLength(1)
      expect(exported.conversations[0]?.history).toMatchObject({
        items: expect.any(Array)
      })
      expect(encodeJson(exported.conversations[0]?.history ?? null)).toContain(
        'history number 0'
      )
      const second = yield* conversations.create({ credential })
      const firstPage = yield* conversations.list({ credential, limit: 1 })
      expect(firstPage.items[0]?.id).toBe(second.id)
      if (firstPage.nextCursor === null) {
        return yield* Effect.die('Expected another conversation page.')
      }
      expect(
        (yield* conversations.list({
          credential,
          limit: 1,
          cursor: firstPage.nextCursor
        })).items[0]?.id
      ).toBe(created.id)
    }).pipe(
      Effect.provideService(WorkspaceContext, workspace),
      Effect.provide(
        makeSeedCapabilitiesLayer({ conversationModel: MockConversationModelLayer })
      ),
      Effect.provideServiceEffect(
        Clock.Clock,
        Clock.clockWith((clock) =>
          Effect.succeed({
            currentTimeNanosUnsafe: () => clock.currentTimeNanosUnsafe(),
            currentTimeNanos: clock.currentTimeNanos,
            monotonicTimeNanosUnsafe: () => clock.monotonicTimeNanosUnsafe(),
            monotonicTimeNanos: clock.monotonicTimeNanos,
            sleep: (duration) => clock.sleep(duration),
            currentTimeMillisUnsafe: () => clock.currentTimeMillisUnsafe() + offset,
            currentTimeMillis: clock.currentTimeMillis.pipe(
              Effect.map((now) => now + offset)
            )
          })
        )
      )
    )
  },
  20_000
)

it.live(
  'the isolated Seed host validates its own authority and cleanup fence before exposing storage',
  () =>
    Effect.gen(function* () {
      const directory = yield* AssistantDirectory
      const host = yield* makeSeedAssistantConversationHost()
      const row = yield* directory.create({
        id: 'host-boundary',
        workspaceId: seedWorkspaceRecord.id,
        creatorUserId: credential.userId
      })
      const authority = {
        conversationId: row.id,
        workspaceId: row.workspaceId,
        creatorUserId: row.creatorUserId,
        userId: credential.userId,
        sessionId: credential.sessionId,
        policyRevision: row.policyRevision
      }
      const identity = { address: row, credential }
      function read(overrides: Partial<typeof identity>) {
        return Effect.promise(() =>
          host.transport.request({ ...identity, ...overrides, action: 'read' })
        )
      }
      expect((yield* read({ address: { ...row, id: 'absent' } })).status).toBe(404)
      expect(
        (yield* read({ credential: { ...credential, sessionId: 'absent' } })).status
      ).toBe(403)
      expect(
        (yield* read({ credential: { ...credential, expiresAt: 0 } })).status
      ).toBe(403)
      const malformed = yield* Effect.promise(() =>
        host.transport.request({ ...identity, action: 'stop' })
      )
      expect(malformed.status).toBe(503)
      expect(yield* Effect.promise(() => malformed.json())).toEqual({
        _tag: 'ConversationUnavailable',
        reason: 'storage'
      })
      const rejected = yield* Effect.promise(() =>
        host.transport.request({
          ...identity,
          action: 'send',
          body: { question: 'Over provider budget', idempotencyKey: 'budget' }
        })
      )
      expect(rejected.status).toBe(400)
      expect(yield* Effect.promise(() => rejected.json())).toEqual({
        _tag: 'ConversationInputRejected',
        reason: 'current_context_budget'
      })
      expect(
        yield* Effect.promise(() => host.lifecycle.revalidateConversation(authority))
      ).toBe(true)
      expect(
        yield* Effect.promise(() =>
          host.lifecycle.revalidateConversation({ ...authority, policyRevision: 1 })
        )
      ).toBe(false)
      expect(
        (yield* Effect.tryPromise(() =>
          host.lifecycle.destroyConversation(authority)
        ).pipe(Effect.result))._tag
      ).toBe('Failure')
      yield* directory.fence({ conversationId: row.id })
      for (const invalid of [
        { ...authority, conversationId: 'absent' },
        { ...authority, workspaceId: 'another-workspace' },
        { ...authority, creatorUserId: 'another-user' }
      ]) {
        expect(
          (yield* Effect.tryPromise(() =>
            host.lifecycle.destroyConversation(invalid)
          ).pipe(Effect.result))._tag
        ).toBe('Failure')
      }
      expect(
        yield* Effect.promise(() => host.lifecycle.revalidateConversation(authority))
      ).toBe(false)
      expect(
        (yield* Effect.tryPromise(() =>
          host.lifecycle.exportConversation(authority)
        ).pipe(Effect.result))._tag
      ).toBe('Failure')
      yield* Effect.promise(() => host.lifecycle.destroyConversation(authority))
      yield* Effect.promise(() => host.lifecycle.destroyConversation(authority))
    }).pipe(
      Effect.scoped,
      Effect.provideService(WorkspaceContext, workspace),
      Effect.provide(SeedLayer),
      Effect.provideService(
        ConversationModel,
        ConversationModel.of({
          prepare: () =>
            Effect.fail(
              new ConversationInputRejected({ reason: 'current_context_budget' })
            ),
          stream: () => Stream.empty
        })
      )
    )
)

it.live(
  'an existing Seed observation closes after access changes without exposing later model output',
  () =>
    Effect.gen(function* () {
      const events = yield* Queue.unbounded<ConversationModelEvent>()
      const model = ConversationModel.of({
        prepare: (input) => prepareConversationContext(input, modelLimits),
        stream: () => Stream.fromQueue(events)
      })
      yield* Effect.gen(function* () {
        const conversations = yield* AssistantConversations
        const directory = yield* AssistantDirectory
        const created = yield* conversations.create({ credential })
        const identity = { credential, conversationId: created.id }
        const accepted = yield* conversations.send({
          ...identity,
          question: 'Observe until revoked',
          idempotencyKey: 'observation'
        })
        const response = yield* conversations.observe({
          ...identity,
          attemptId: accepted.attempt.id
        })
        const reader = response.body?.getReader()
        if (reader === undefined) {
          return yield* Effect.die('Missing observation stream.')
        }
        const first = yield* Effect.promise(() => reader.read())
        expect(new TextDecoder().decode(first.value)).toContain('event: snapshot')
        yield* directory.raisePolicy(created.id, ['unknown:permission'])
        yield* Queue.offer(events, { type: 'text-delta', text: 'private later output' })
        const last = yield* Effect.promise(() => reader.read())
        const text = new TextDecoder().decode(last.value)
        expect(text).toContain('access_unavailable')
        expect(text).not.toContain('private later output')
        expect((yield* Effect.promise(() => reader.read())).done).toBe(true)
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

it.live('retains a stale task reference without fabricating historical evidence', () =>
  Effect.gen(function* () {
    const conversations = yield* AssistantConversations
    const created = yield* conversations.create({ credential })
    const identity = { credential, conversationId: created.id }
    const accepted = yield* conversations.send({
      ...identity,
      question: 'Explain the missing task',
      taskId: 'deleted-task',
      idempotencyKey: 'stale-task'
    })
    expect(accepted.question.taskId).toBe('deleted-task')
    expect(accepted.attempt.evidence).toBe(null)
    const saved = yield* conversations.history(identity).pipe(
      Effect.repeat({
        while: (page) => page.items[0]?.attempts[0]?.status !== 'Completed',
        schedule: Schedule.spaced('1 millis')
      }),
      Effect.timeout('5 seconds')
    )
    expect(saved.items[0]?.question.taskId).toBe('deleted-task')
    expect(saved.items[0]?.attempts[0]?.evidence).toBe(null)
  }).pipe(
    Effect.provideService(WorkspaceContext, workspace),
    Effect.provide(
      makeSeedCapabilitiesLayer({ conversationModel: MockConversationModelLayer })
    )
  )
)

it.live(
  'revocation and restoration close the old Seed observation and require an explicit new attempt',
  () =>
    Effect.gen(function* () {
      const events = yield* Queue.unbounded<ConversationModelEvent>()
      let calls = 0
      const model = ConversationModel.of({
        prepare: (input) => prepareConversationContext(input, modelLimits),
        stream: () => {
          calls += 1
          return Stream.fromQueue(events).pipe(
            Stream.takeUntil((event) => event.type === 'finish')
          )
        }
      })
      yield* Effect.gen(function* () {
        const conversations = yield* AssistantConversations
        const directory = yield* AssistantDirectory
        const created = yield* conversations.create({ credential })
        const identity = { credential, conversationId: created.id }
        const input = {
          ...identity,
          question: 'Keep my saved prefix',
          idempotencyKey: 'before-revocation'
        }
        const accepted = yield* conversations.send(input)
        yield* Queue.offer(events, { type: 'text-delta', text: 'Saved prefix' })
        yield* conversations.history(identity).pipe(
          Effect.repeat({
            while: (page) => page.items[0]?.attempts[0]?.text !== 'Saved prefix',
            schedule: Schedule.spaced('1 millis')
          }),
          Effect.timeout('5 seconds')
        )
        const oldObservation = yield* conversations.observe({
          ...identity,
          attemptId: accepted.attempt.id
        })
        const reader = oldObservation.body?.getReader()
        if (reader === undefined) {
          return yield* Effect.die('Missing observation stream.')
        }
        expect(
          new TextDecoder().decode((yield* Effect.promise(() => reader.read())).value)
        ).toContain('Saved prefix')
        // Both access transitions occur before the next model batch; current authority is valid again.
        yield* directory.invalidateAccess(
          { conversationId: created.id },
          { interruptRuns: true }
        )
        yield* directory.invalidateAccess(
          { conversationId: created.id },
          { interruptRuns: true }
        )
        yield* Queue.offer(events, { type: 'text-delta', text: ' must not be saved' })
        const interrupted = yield* conversations.history(identity).pipe(
          Effect.repeat({
            while: (page) => page.items[0]?.attempts[0]?.status !== 'Interrupted',
            schedule: Schedule.spaced('1 millis')
          }),
          Effect.timeout('5 seconds')
        )
        expect(interrupted.items[0]?.attempts[0]).toMatchObject({
          status: 'Interrupted',
          reason: 'authority',
          text: 'Saved prefix'
        })
        expect(
          new TextDecoder().decode((yield* Effect.promise(() => reader.read())).value)
        ).toContain('access_unavailable')
        expect((yield* Effect.promise(() => reader.read())).done).toBe(true)
        const fresh = yield* conversations.observe({
          ...identity,
          attemptId: accepted.attempt.id
        })
        const snapshot = yield* Effect.promise(() => fresh.text())
        expect(snapshot).toContain('Saved prefix')
        expect(snapshot).toContain('event: terminal')
        expect((yield* conversations.send(input)).attempt.id).toBe(accepted.attempt.id)
        expect(calls).toBe(1)
        const retry = yield* conversations.retry({
          ...identity,
          attemptId: accepted.attempt.id,
          idempotencyKey: 'after-restoration'
        })
        expect(retry.question.id).toBe(accepted.question.id)
        yield* Queue.offer(events, {
          type: 'text-delta',
          text: 'Fresh complete answer'
        })
        yield* Queue.offer(events, { type: 'finish', reason: 'stop' })
        const completed = yield* conversations.history(identity).pipe(
          Effect.repeat({
            while: (page) => page.items[0]?.attempts[1]?.status !== 'Completed',
            schedule: Schedule.spaced('1 millis')
          }),
          Effect.timeout('5 seconds')
        )
        expect(completed.items).toHaveLength(1)
        expect(completed.items[0]?.attempts.map((attempt) => attempt.text)).toEqual([
          'Saved prefix',
          'Fresh complete answer'
        ])
        expect(calls).toBe(2)
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
