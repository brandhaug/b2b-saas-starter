import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { Effect } from 'effect'
import {
  type AssistantReply,
  AssistantService,
  type AssistantUnavailable,
  AssistantLive,
  makeOpenAIModel,
  type OpenAIConfig
} from './index.ts'

// oxlint-disable-next-line effect/noTestLifecycleHooks -- restores the global fetch each stub replaced
afterEach(() => {
  vi.unstubAllGlobals()
})

function ask(config: OpenAIConfig, assert: (reply: AssistantReply) => void) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* AssistantService
      const reply = yield* service.ask({
        workspaceSlug: 'starter-lab',
        question: 'What changed?'
      })
      assert(reply)
    }).pipe(Effect.provide(AssistantLive), Effect.provide(makeOpenAIModel(config)))
  )
}

function flipsToUnavailable(
  config: OpenAIConfig,
  assert: (error: AssistantUnavailable) => void
) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* AssistantService
      const error = yield* Effect.flip(
        service.ask({ workspaceSlug: 'starter-lab', question: 'What changed?' })
      )
      assert(error)
    }).pipe(Effect.provide(AssistantLive), Effect.provide(makeOpenAIModel(config)))
  )
}

/** The wire body the adapter reads; one place for the platform's Response. */
function jsonResponse(body: unknown, status = 200) {
  // oxlint-disable-next-line effect/noGlobals -- hand-serialized fixture JSON is the point of a wire-body double
  return new Response(JSON.stringify(body), { status })
}

/** Captures what the adapter posted, so assertions read the real call. */
function stubFetch(respond: () => Response) {
  const posted: Array<{
    url: string
    headers: Record<string, string>
    body: string
  }> = []
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: { headers: Record<string, string>; body: string }) => {
      posted.push({ url, headers: init.headers, body: init.body })
      return Promise.resolve(respond())
    })
  )
  return posted
}

const TEST_KEY: OpenAIConfig = { apiKey: 'test-key' }

function postsTheNormalizedPrompt(): Promise<void> {
  const posted = stubFetch(() =>
    jsonResponse({
      choices: [
        { message: { content: 'The onboarding checklist.' }, finish_reason: 'stop' }
      ]
    })
  )
  return ask(TEST_KEY, (reply) => {
    expect(reply.answer).toBe('The onboarding checklist.')
    expect(reply.provider).toBe('openai-compatible')
    expect(reply.modelId).toBe('gpt-4o-mini')
    expect(reply.usedTools).toEqual([])

    expect(posted).toHaveLength(1)
    expect(posted[0]?.url).toBe('https://api.openai.com/v1/chat/completions')
    expect(posted[0]?.headers).toEqual({
      authorization: 'Bearer test-key',
      'content-type': 'application/json'
    })
    // oxlint-disable-next-line effect/noGlobals -- the assertion reads the raw wire body the adapter posted
    const body = JSON.parse(posted[0]?.body ?? '{}')
    expect(body.model).toBe('gpt-4o-mini')
    expect(body.messages).toEqual([
      {
        role: 'system',
        content: 'You are the B2B SaaS Starter assistant for workspace starter-lab.'
      },
      { role: 'user', content: 'What changed?' }
    ])
  })
}

function honorsOverrides(): Promise<void> {
  const posted = stubFetch(() =>
    jsonResponse({ choices: [{ message: { content: 'x' } }] })
  )
  return ask(
    {
      apiKey: 'test-key',
      baseUrl: 'https://proxy.example.com/v1',
      modelId: 'other-model'
    },
    (reply) => {
      expect(posted[0]?.url).toBe('https://proxy.example.com/v1/chat/completions')
      expect(reply.modelId).toBe('other-model')
    }
  )
}

describe('openai-compatible model', () => {
  it(
    'posts the normalized prompt and answers with the first choice',
    postsTheNormalizedPrompt
  )

  it('honors baseUrl and modelId overrides', honorsOverrides)

  it('maps a rate-limited provider onto AssistantUnavailable', () => {
    stubFetch(() => jsonResponse({ error: 'slow down' }, 429))
    return flipsToUnavailable(TEST_KEY, (error) => {
      expect(error._tag).toBe('AssistantUnavailable')
      expect(error.reason).toContain('openai-compatible')
      expect(error.reason).toContain('Rate limit exceeded')
    })
  })

  it('fails unavailable when the response body has no usable choice', () => {
    stubFetch(() => jsonResponse({ choices: [] }))
    return flipsToUnavailable(TEST_KEY, (error) => {
      expect(error._tag).toBe('AssistantUnavailable')
      expect(error.reason).toContain('does not match the chat shape')
    })
  })
})
