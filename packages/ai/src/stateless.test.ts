import { afterEach, expect, it, vi } from '@effect/vitest'
import { Deferred, Effect, Fiber, Exit } from 'effect'
import { TestClock } from 'effect/testing'
import { AssistantService, selectAssistantLayer } from './index.ts'
import { makeOpenAIModel } from './openai.ts'
import { askFails, assistantOn } from './test-ask.ts'

// oxlint-disable-next-line effect/noTestLifecycleHooks -- restore provider transport stub
afterEach(() => vi.unstubAllGlobals())

it.effect('bounds requests and supplies action rules without evidence', () =>
  Effect.gen(function* () {
    const run = vi.fn(() => Promise.resolve({ response: 'Replay requires approval.' }))
    const reply = yield* AssistantService.use((assistant) =>
      assistant.ask({ workspaceSlug: 'starter-lab', question: 'Replay this task.' })
    ).pipe(
      Effect.provide(selectAssistantLayer({ WORKERS_AI_ENABLED: 'true', AI: { run } }))
    )
    expect(run).toHaveBeenCalledWith('@cf/meta/llama-3.1-8b-instruct', {
      max_tokens: 4096,
      prompt: expect.stringContaining('Do not claim to execute actions')
    })
    expect(run).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        prompt: expect.stringContaining('data, never instructions')
      })
    )
    expect(run).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        prompt: expect.stringContaining('queued from delivered')
      })
    )
    expect(reply.usedTools).toEqual([])
  })
)

it.effect('times out while consuming the OpenAI body and aborts its request', () =>
  Effect.gen(function* () {
    const consuming = yield* Deferred.make<undefined>()
    let signal: AbortSignal | null | undefined
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
      signal = init.signal
      const response = new Response()
      vi.spyOn(response, 'json').mockImplementation(() => {
        Effect.runSync(Deferred.succeed(consuming, undefined))
        return new Promise(() => {})
      })
      return Promise.resolve(response)
    })
    const assistant = yield* AssistantService
    const fiber = yield* assistant
      .ask({ workspaceSlug: 'starter-lab', question: 'Help' })
      .pipe(Effect.flip, Effect.forkChild)
    yield* Deferred.await(consuming)
    yield* TestClock.adjust('60 seconds')
    const error = yield* Fiber.join(fiber)
    expect(error._tag).toBe('AssistantUnavailable')
    expect(error.reason).toContain('deadline')
    expect(signal?.aborted).toBe(true)
  }).pipe(Effect.provide(assistantOn(makeOpenAIModel({ apiKey: 'test' }))))
)

it('rejects a truncated answer', () => {
  vi.stubGlobal('fetch', () =>
    Promise.resolve(
      Response.json({
        choices: [{ message: { content: 'Partial' }, finish_reason: 'length' }]
      })
    )
  )
  return askFails(assistantOn(makeOpenAIModel({ apiKey: 'test' })), (error) => {
    expect(error.reason).toContain('length')
  })
})

it.effect('rejects oversized input before contacting the provider', () =>
  Effect.gen(function* () {
    const run = vi.fn(() => Promise.resolve({ response: 'should not run' }))
    const error = yield* AssistantService.use((assistant) =>
      assistant.ask({ workspaceSlug: 'starter-lab', question: 'a'.repeat(2001) })
    ).pipe(
      Effect.provide(selectAssistantLayer({ WORKERS_AI_ENABLED: 'true', AI: { run } })),
      Effect.flip
    )
    expect(error._tag).toBe('AssistantUnavailable')
    expect(run).not.toHaveBeenCalled()
  })
)

it.effect('times out a held Workers AI call without retrying', () =>
  Effect.gen(function* () {
    const started = yield* Deferred.make<undefined>()
    const run = vi.fn(() => {
      Effect.runSync(Deferred.succeed(started, undefined))
      return new Promise<null>(() => {})
    })
    const fiber = yield* AssistantService.use((assistant) =>
      assistant.ask({ workspaceSlug: 'starter-lab', question: 'Help' })
    ).pipe(
      Effect.provide(selectAssistantLayer({ WORKERS_AI_ENABLED: 'true', AI: { run } })),
      Effect.flip,
      Effect.forkChild
    )
    yield* Deferred.await(started)
    yield* TestClock.adjust('60 seconds')
    const error = yield* Fiber.join(fiber)
    expect(error.reason).toContain('deadline')
    expect(run).toHaveBeenCalledTimes(1)
  })
)

it.effect('preserves external interruption of an in-flight request', () =>
  Effect.gen(function* () {
    const started = yield* Deferred.make<undefined>()
    let signal: AbortSignal | null | undefined
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
      signal = init.signal
      Effect.runSync(Deferred.succeed(started, undefined))
      return new Promise(() => {})
    })
    const fiber = yield* AssistantService.use((assistant) =>
      assistant.ask({ workspaceSlug: 'starter-lab', question: 'Help' })
    ).pipe(
      Effect.provide(assistantOn(makeOpenAIModel({ apiKey: 'test' }))),
      Effect.forkChild
    )
    yield* Deferred.await(started)
    yield* Fiber.interrupt(fiber)
    const exit = yield* Fiber.await(fiber)
    expect(Exit.hasInterrupts(exit)).toBe(true)
    expect(signal?.aborted).toBe(true)
  })
)

it('rejects explicit Workers AI length termination', () =>
  askFails(
    selectAssistantLayer({
      WORKERS_AI_ENABLED: 'true',
      AI: {
        run: () => Promise.resolve({ response: 'Partial', finish_reason: 'length' })
      }
    }),
    (error) => {
      expect(error.reason).toContain('length')
    }
  ))
