import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { ConversationModel, selectConversationModelLayer } from './conversation.ts'

describe('conversation model admission', () => {
  it.effect('refuses unconfigured generation before constructing a model request', () =>
    Effect.gen(function* () {
      const model = yield* ConversationModel
      const error = yield* Effect.flip(
        model.prepare({
          workspaceSlug: 'starter-lab',
          question: 'What changed?',
          history: []
        })
      )
      expect(error._tag).toBe('ConversationModelUnavailable')
      expect(error.reason).toBe('unconfigured')
    }).pipe(Effect.provide(selectConversationModelLayer({})))
  )
})

it.effect(
  'keeps the current question and drops oldest complete exchanges to fit reserved context',
  () =>
    Effect.gen(function* () {
      const model = yield* ConversationModel
      const prepared = yield* model.prepare({
        workspaceSlug: 'starter-lab',
        question: 'Current question',
        history: [
          { questionId: 'old', question: 'Old question', answer: 'x'.repeat(1500) },
          { questionId: 'recent', question: 'Recent question', answer: 'Recent answer' }
        ]
      })
      expect(prepared.omittedExchanges).toBe(1)
      expect(prepared.messages.map((message) => message.content)).toContain(
        'Recent answer'
      )
      expect(prepared.messages.at(-1)?.content).toBe('Current question')
      expect(prepared.maxOutputTokens).toBe(100)
    }).pipe(
      Effect.provide(
        selectConversationModelLayer(
          { OPENAI_API_KEY: 'test-key' },
          {
            maxInputTokens: 1500,
            maxOutputTokens: 100,
            providerContextTokens: 1600,
            providerOutputTokens: 100
          }
        )
      )
    )
)

it.effect('rejects oversized current evidence without silently shortening it', () =>
  Effect.gen(function* () {
    const model = yield* ConversationModel
    const error = yield* Effect.flip(
      model.prepare({
        workspaceSlug: 'starter-lab',
        question: 'Explain',
        history: [],
        evidence: {
          taskId: 'task-1',
          sourceId: 'delivery-1',
          observedAt: '2026-09-15T12:00:00Z',
          text: 'x'.repeat(1200)
        }
      })
    )
    expect(error._tag).toBe('ConversationInputRejected')
  }).pipe(
    Effect.provide(
      selectConversationModelLayer(
        { OPENAI_API_KEY: 'test-key' },
        { maxInputTokens: 1000 }
      )
    )
  )
)

it.effect(
  'labels prior task observations as historical while preserving their identity',
  () =>
    Effect.gen(function* () {
      const model = yield* ConversationModel
      const prompt = yield* model.prepare({
        workspaceSlug: 'starter-lab',
        question: 'What changed?',
        history: [
          {
            questionId: 'question-1',
            question: 'Why did delivery fail?',
            answer: 'The receiver returned an error.',
            evidence: {
              taskId: 'task-1',
              sourceId: 'delivery-1',
              observedAt: '2026-09-15T12:00:00Z',
              text: 'Status 503'
            }
          }
        ]
      })
      expect(prompt.messages[1]?.content).toContain(
        'Historical task observation. Task: task-1. Source: delivery-1. Observed at: 2026-09-15T12:00:00Z.'
      )
      expect(prompt.omittedExchanges).toBe(0)
    }).pipe(
      Effect.provide(selectConversationModelLayer({ OPENAI_API_KEY: 'test-key' }))
    )
)

it.effect('requires declared provider limits for custom compatible models', () =>
  Effect.gen(function* () {
    const model = yield* ConversationModel
    const error = yield* Effect.flip(
      model.prepare({ workspaceSlug: 'starter-lab', question: 'Hello', history: [] })
    )
    expect(error._tag).toBe('ConversationModelUnavailable')
  }).pipe(
    Effect.provide(
      selectConversationModelLayer({
        OPENAI_API_KEY: 'test-key',
        OPENAI_MODEL_ID: 'custom-model'
      })
    )
  )
)

it.effect(
  'applies the lower known provider ceiling even when configuration asks for more',
  () =>
    Effect.gen(function* () {
      const model = yield* ConversationModel
      const prompt = yield* model.prepare({
        workspaceSlug: 'starter-lab',
        question: 'Hello',
        history: []
      })
      expect(prompt.maxOutputTokens).toBe(16_384)
    }).pipe(
      Effect.provide(
        selectConversationModelLayer(
          { OPENAI_API_KEY: 'test-key' },
          { maxOutputTokens: 32_000, providerOutputTokens: 32_000 }
        )
      )
    )
)
