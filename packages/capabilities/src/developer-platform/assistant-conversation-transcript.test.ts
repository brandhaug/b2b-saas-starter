import { expect, it } from '@effect/vitest'
import { Effect, Stream } from 'effect'
import { ConversationModel } from '@b2b-saas-starter/ai/conversation'
import { prepareConversationContext } from '@b2b-saas-starter/ai/conversation-context'
import { makeSeedConversationLedger } from './assistant-conversation-ledger.seed.ts'
import {
  readConversationHistory,
  prepareTranscriptContext
} from './assistant-conversation-transcript.ts'
import { type ConversationAttempt } from './assistant-conversation.ts'
import { credential, modelLimits } from './assistant-conversation.seed-fixture.ts'

it.effect(
  'pages whole exchanges and stops loading model history at the context budget',
  () =>
    Effect.gen(function* () {
      const { ledger, texts } = makeSeedConversationLedger()
      const prompt = yield* prepareConversationContext(
        { workspaceSlug: 'starter-lab', question: 'Next', history: [] },
        modelLimits
      )
      for (let index = 0; index < 100; index += 1) {
        const id = String(index).padStart(3, '0')
        const question = {
          id: `q-${id}`,
          text: `Question ${id}`,
          createdAt: '2026-09-15T12:00:00.000Z',
          taskId: null
        }
        const attempt: ConversationAttempt = {
          id: `a-${id}`,
          questionId: question.id,
          createdAt: question.createdAt,
          deadline: 600_000,
          status: 'Accepted',
          reason: null,
          completedAt: null,
          provider: null,
          modelId: null,
          providerRequestId: null,
          finishReason: null,
          inputTokens: null,
          outputTokens: null,
          omittedExchanges: 0,
          evidence: null
        }
        yield* ledger.accept({
          key: id,
          hash: id,
          acceptance: { question, attempt, joined: false },
          execution: { credential, prompt, runAccessRevision: 0 }
        })
        yield* ledger.update({
          ...attempt,
          status: 'Completed',
          completedAt: question.createdAt
        })
        texts.set(attempt.id, 'Answer '.repeat(100))
      }
      const page = yield* readConversationHistory(ledger, {
        cursor: null,
        full: false,
        policyRevision: 4,
        text: (id) => Effect.succeed(texts.get(id) ?? '')
      })
      expect(page.items).toHaveLength(30)
      expect(page.items[0]?.question.id).toBe('q-070')
      expect(page.nextCursor).toBe('q-070')
      const older = yield* readConversationHistory(ledger, {
        cursor: page.nextCursor,
        full: false,
        policyRevision: 4,
        text: (id) => Effect.succeed(texts.get(id) ?? '')
      })
      expect(older.items[0]?.question.id).toBe('q-040')
      let reads = 0
      const prepared = yield* prepareTranscriptContext(ledger, {
        workspaceSlug: 'starter-lab',
        question: 'Next',
        text: (id) =>
          Effect.sync(() => {
            reads += 1
            return texts.get(id) ?? ''
          })
      }).pipe(
        Effect.provideService(
          ConversationModel,
          ConversationModel.of({
            prepare: (input) =>
              prepareConversationContext(input, {
                ...modelLimits,
                maxInputTokens: 3000
              }),
            stream: () => Stream.empty
          })
        )
      )
      expect(reads).toBeLessThan(100)
      expect(prepared.omittedExchanges).toBeGreaterThan(90)
      const expected = yield* prepareConversationContext(
        {
          workspaceSlug: 'starter-lab',
          question: 'Next',
          history: Array.from({ length: 100 }, (_, index) => {
            const id = String(index).padStart(3, '0')
            return {
              questionId: `q-${id}`,
              question: `Question ${id}`,
              answer: 'Answer '.repeat(100)
            }
          })
        },
        { ...modelLimits, maxInputTokens: 3000 }
      )
      expect(prepared).toEqual(expected)
    })
)
