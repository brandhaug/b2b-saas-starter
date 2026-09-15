// oxlint-disable-next-line effect/noNodeBuiltinImport -- reads a captured SSE test fixture; never enters a Worker bundle
import { readFile } from 'node:fs/promises'
import { failureMessage } from '@b2b-saas-starter/failure'
import { afterEach, describe, expect, it, vi } from '@effect/vitest'
import { Deferred, Effect, Fiber, Stream } from 'effect'
import {
  ConversationModel,
  selectConversationModelLayer,
  type ConversationModelEvent
} from './conversation.ts'

// oxlint-disable-next-line effect/noTestLifecycleHooks -- each test owns its provider fetch fixture
afterEach(() => vi.unstubAllGlobals())

function streamResponse(events: ReadonlyArray<string>) {
  return new Response(events.map((event) => `data: ${event}\n\n`).join(''), {
    headers: { 'content-type': 'text/event-stream' }
  })
}

function stubResponse(events: ReadonlyArray<string>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(streamResponse(events)))
  )
}

const layer = selectConversationModelLayer(
  { OPENAI_API_KEY: 'test-key' },
  { maxOutputTokens: 100 }
)

describe('conversation model streaming', () => {
  it.effect(
    'preserves partial output and token usage when the provider reaches its output limit',
    () => {
      stubResponse([
        '{"id":"response-1","model":"gpt-4o-mini-snapshot","choices":[{"delta":{"content":"Saved partial answer"},"finish_reason":null}]}',
        '{"choices":[{"delta":{},"finish_reason":"length"}]}',
        '{"choices":[],"usage":{"prompt_tokens":40,"completion_tokens":100}}',
        '[DONE]'
      ])
      return Effect.gen(function* () {
        const model = yield* ConversationModel
        const prompt = yield* model.prepare({
          workspaceSlug: 'starter-lab',
          question: 'Explain',
          history: []
        })
        const events: Array<ConversationModelEvent> = []
        const error = yield* Effect.flip(
          model
            .stream(prompt)
            .pipe(Stream.runForEach((event) => Effect.sync(() => events.push(event))))
        )
        expect(events).toContainEqual({
          type: 'text-delta',
          text: 'Saved partial answer'
        })
        expect(
          events.find(
            (event) =>
              event.type === 'metadata' && event.providerRequestId !== undefined
          )
        ).toMatchObject({
          modelId: 'gpt-4o-mini-snapshot',
          providerRequestId: 'response-1'
        })
        expect(events.at(-1)).toMatchObject({
          type: 'finish',
          reason: 'length',
          inputTokens: 40,
          outputTokens: 100
        })
        expect(error.reason).toBe('output-limit')
      }).pipe(Effect.provide(layer))
    }
  )

  it.effect('does not confuse output bytes with tokens', () => {
    const answer =
      'This answer has more than one hundred bytes of ordinary text, but the provider reports only twenty four tokens in the completed response.'
    stubResponse([
      // oxlint-disable-next-line effect/noGlobals -- serialized provider fixture
      JSON.stringify({
        choices: [{ delta: { content: answer }, finish_reason: 'stop' }],
        usage: { completion_tokens: 24 }
      }),
      '[DONE]'
    ])
    return Effect.gen(function* () {
      const model = yield* ConversationModel
      const prompt = yield* model.prepare({
        workspaceSlug: 'starter-lab',
        question: 'Explain',
        history: []
      })
      const events = yield* model.stream(prompt).pipe(Stream.runCollect)
      expect(events).toContainEqual({ type: 'text-delta', text: answer })
      expect(events.at(-1)).toMatchObject({ type: 'finish', outputTokens: 24 })
    }).pipe(Effect.provide(layer))
  })

  it.effect(
    'fails explicitly on non-text provider content and never retries inference',
    () => {
      stubResponse([
        '{"choices":[{"delta":{"content":"prefix","tool_calls":[{"name":"replay"}]},"finish_reason":null}]}',
        '[DONE]'
      ])
      return Effect.gen(function* () {
        const model = yield* ConversationModel
        const prompt = yield* model.prepare({
          workspaceSlug: 'starter-lab',
          question: 'Explain',
          history: []
        })
        const error = yield* Effect.flip(model.stream(prompt).pipe(Stream.runCollect))
        expect(error._tag).toBe('ConversationModelFailure')
        expect(fetch).toHaveBeenCalledTimes(1)
      }).pipe(Effect.provide(layer))
    }
  )

  it.effect('does not treat a severed stream as a completed answer', () => {
    stubResponse([
      '{"choices":[{"delta":{"content":"Partial answer"},"finish_reason":null}]}'
    ])
    return Effect.gen(function* () {
      const model = yield* ConversationModel
      const prompt = yield* model.prepare({
        workspaceSlug: 'starter-lab',
        question: 'Explain',
        history: []
      })
      const error = yield* Effect.flip(model.stream(prompt).pipe(Stream.runCollect))
      expect(error.reason).toBe('provider')
      expect(failureMessage(error)).not.toContain('test-key')
    }).pipe(Effect.provide(layer))
  })

  it.effect('interrupts the request and cancels the response reader when stopped', () =>
    Effect.gen(function* () {
      const firstText = yield* Deferred.make<undefined>()
      let cancelled = false
      let requestSignal: AbortSignal | null | undefined
      vi.stubGlobal(
        'fetch',
        vi.fn((_url: string, init: RequestInit) => {
          requestSignal = init.signal
          return Promise.resolve(
            new Response(
              new ReadableStream<Uint8Array>({
                start(controller) {
                  controller.enqueue(
                    new TextEncoder().encode(
                      'data: {"choices":[{"delta":{"content":"Partial answer"},"finish_reason":null}]}\n\n'
                    )
                  )
                },
                cancel() {
                  cancelled = true
                }
              }),
              { headers: { 'content-type': 'text/event-stream' } }
            )
          )
        })
      )
      const model = yield* ConversationModel
      const prompt = yield* model.prepare({
        workspaceSlug: 'starter-lab',
        question: 'Explain',
        history: []
      })
      const fiber = yield* model.stream(prompt).pipe(
        Stream.runForEach((event) => {
          if (event.type === 'text-delta') {
            return Deferred.succeed(firstText, undefined)
          }
          return Effect.void
        }),
        Effect.forkChild
      )
      yield* Deferred.await(firstText)
      yield* Fiber.interrupt(fiber)
      expect(requestSignal?.aborted).toBe(true)
      expect(cancelled).toBe(true)
    }).pipe(Effect.provide(layer))
  )
})

it.effect(
  'accepts the captured Workers AI compatible terminal usage frame without counting tokens twice',
  () =>
    Effect.gen(function* () {
      const captured = yield* Effect.promise(() =>
        readFile(
          new URL('./fixtures/workers-ai-compatible.sse', import.meta.url),
          'utf8'
        )
      )
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve(
            new Response(captured, { headers: { 'content-type': 'text/event-stream' } })
          )
        )
      )
      const model = yield* ConversationModel
      const prompt = yield* model.prepare({
        workspaceSlug: 'starter-lab',
        question: 'Streaming test',
        history: []
      })
      const events = yield* model.stream(prompt).pipe(Stream.runCollect)
      expect(
        events
          .filter((event) => event.type === 'text-delta')
          .map((event) => event.text)
          .join('')
      ).toBe('Streaming test passed.')
      expect(events.filter((event) => event.type === 'finish')).toEqual([
        { type: 'finish', reason: 'stop', inputTokens: 21, outputTokens: 5 }
      ])
    }).pipe(Effect.provide(layer))
)

it.effect(
  'rejects conflicting terminal reasons, repeated terminals without usage, and text after completion',
  () =>
    Effect.gen(function* () {
      const invalidTerminals = [
        '{"choices":[{"delta":{},"finish_reason":"length"}],"usage":{"completion_tokens":5}}',
        '{"choices":[{"delta":{},"finish_reason":"stop"}]}',
        '{"choices":[{"delta":{"content":"late text"},"finish_reason":"stop"}],"usage":{"completion_tokens":5}}'
      ]
      for (const terminal of invalidTerminals) {
        stubResponse([
          '{"choices":[{"delta":{"content":"prefix"},"finish_reason":"stop"}]}',
          terminal,
          '[DONE]'
        ])
        const model = yield* ConversationModel
        const prompt = yield* model.prepare({
          workspaceSlug: 'starter-lab',
          question: 'Streaming test',
          history: []
        })
        const error = yield* model.stream(prompt).pipe(Stream.runCollect, Effect.flip)
        expect(error).toMatchObject({
          _tag: 'ConversationModelFailure',
          reason: 'provider'
        })
      }
    }).pipe(Effect.provide(layer))
)

it.effect(
  'treats reaching the token ceiling as interrupted regardless of the provider finish reason',
  () =>
    Effect.gen(function* () {
      const native = selectConversationModelLayer(
        {
          WORKERS_AI_ENABLED: 'true',
          AI: {
            run: () =>
              Promise.resolve(
                streamResponse([
                  '{"response":"Partial native answer","usage":{"prompt_tokens":21,"completion_tokens":100}}',
                  '[DONE]'
                ]).body
              )
          }
        },
        { maxOutputTokens: 100 }
      )
      yield* Effect.gen(function* () {
        const model = yield* ConversationModel
        const prompt = yield* model.prepare({
          workspaceSlug: 'starter-lab',
          question: 'Explain',
          history: []
        })
        const events: Array<ConversationModelEvent> = []
        const error = yield* model.stream(prompt).pipe(
          Stream.runForEach((event) => Effect.sync(() => events.push(event))),
          Effect.flip
        )
        expect(events).toContainEqual({
          type: 'text-delta',
          text: 'Partial native answer'
        })
        expect(events.at(-1)).toEqual({
          type: 'finish',
          reason: 'unknown',
          inputTokens: 21,
          outputTokens: 100
        })
        expect(error.reason).toBe('output-limit')
      }).pipe(Effect.provide(native))
      stubResponse([
        '{"choices":[{"delta":{"content":"Complete answer"},"finish_reason":"stop"}],"usage":{"completion_tokens":100}}',
        '[DONE]'
      ])
      yield* Effect.gen(function* () {
        const model = yield* ConversationModel
        const prompt = yield* model.prepare({
          workspaceSlug: 'starter-lab',
          question: 'Explain',
          history: []
        })
        const events: Array<ConversationModelEvent> = []
        const error = yield* model.stream(prompt).pipe(
          Stream.runForEach((event) => Effect.sync(() => events.push(event))),
          Effect.flip
        )
        expect(error.reason).toBe('output-limit')
        expect(events.at(-1)).toMatchObject({
          type: 'finish',
          reason: 'stop',
          outputTokens: 100
        })
      }).pipe(Effect.provide(layer))
    })
)
