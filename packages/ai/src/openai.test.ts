import { failureMessage } from '@b2b-saas-starter/failure'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { Effect, Schema } from 'effect'
import { LanguageModel, Prompt } from 'effect/unstable/ai'
import { type OpenAIConfig, makeOpenAIModel } from './openai.ts'
import { ask, askFails, assistantOn } from './test-ask.ts'

// oxlint-disable-next-line effect/noTestLifecycleHooks -- restores the global fetch each stub replaced
afterEach(() => {
  vi.unstubAllGlobals()
})

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

const TEST_CONFIG: OpenAIConfig = { apiKey: 'test-key' }

describe('openai-compatible model', () => {
  it('posts the normalized prompt and answers with the first choice', () => {
    const posted = stubFetch(() =>
      jsonResponse({
        choices: [
          { message: { content: 'The onboarding checklist.' }, finish_reason: 'stop' }
        ]
      })
    )
    return ask(assistantOn(makeOpenAIModel(TEST_CONFIG)), (reply) => {
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
  })

  it('honors baseUrl and modelId overrides', () => {
    const posted = stubFetch(() =>
      jsonResponse({ choices: [{ message: { content: 'x' } }] })
    )
    return ask(
      assistantOn(
        makeOpenAIModel({
          apiKey: 'test-key',
          baseUrl: 'https://proxy.example.com/v1',
          modelId: 'other-model'
        })
      ),
      (reply) => {
        expect(posted[0]?.url).toBe('https://proxy.example.com/v1/chat/completions')
        expect(reply.modelId).toBe('other-model')
      }
    )
  })

  it('refuses a prompt carrying a part it cannot send as plain chat', () => {
    const posted = stubFetch(() =>
      jsonResponse({ choices: [{ message: { content: 'never read' } }] })
    )
    return Effect.runPromise(
      Effect.gen(function* () {
        const model = yield* LanguageModel.LanguageModel
        const error = yield* Effect.flip(
          model.generateText({
            prompt: Prompt.make([
              {
                role: 'user',
                content: [
                  { type: 'text', text: 'summarize this' },
                  { type: 'file', mediaType: 'text/plain', data: 'notes.txt' }
                ]
              }
            ])
          })
        )
        expect(error._tag).toBe('AiError')
        expect(error.reason._tag).toBe('InvalidUserInputError')
        expect(posted).toHaveLength(0)
      }).pipe(Effect.provide(makeOpenAIModel(TEST_CONFIG)))
    )
  })

  it('refuses structured-output requests before any request is sent', () => {
    const posted = stubFetch(() =>
      jsonResponse({ choices: [{ message: { content: 'never read' } }] })
    )
    return Effect.runPromise(
      Effect.gen(function* () {
        const model = yield* LanguageModel.LanguageModel
        const error = yield* Effect.flip(
          model.generateObject({
            prompt: 'Answer with a reply object.',
            schema: Schema.Struct({ answer: Schema.String }),
            objectName: 'reply'
          })
        )
        expect(failureMessage(error)).toContain('structured output')
        expect(posted).toHaveLength(0)
      }).pipe(Effect.provide(makeOpenAIModel(TEST_CONFIG)))
    )
  })

  it('maps a rate-limited provider onto AssistantUnavailable', () => {
    stubFetch(() => jsonResponse({ error: 'slow down' }, 429))
    return askFails(assistantOn(makeOpenAIModel(TEST_CONFIG)), (error) => {
      expect(error._tag).toBe('AssistantUnavailable')
      expect(error.reason).toContain('openai-compatible')
      expect(error.reason).toContain('Rate limit exceeded')
    })
  })

  it('fails unavailable on a transport failure, without the credential', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('network down')))
    )
    return askFails(assistantOn(makeOpenAIModel(TEST_CONFIG)), (error) => {
      expect(error._tag).toBe('AssistantUnavailable')
      expect(error.reason).toContain('network down')
      expect(error.reason).not.toContain('test-key')
    })
  })

  it('fails unavailable when the response body has no usable choice', () => {
    stubFetch(() => jsonResponse({ choices: [] }))
    return askFails(assistantOn(makeOpenAIModel(TEST_CONFIG)), (error) => {
      expect(error._tag).toBe('AssistantUnavailable')
      expect(error.reason).toContain('does not match the chat shape')
    })
  })
})
