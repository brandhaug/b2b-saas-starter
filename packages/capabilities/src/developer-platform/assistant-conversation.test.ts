import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import {
  admitConversationOperation,
  conversationHistoryPage,
  canonicalConversationOperation,
  type ConversationAttempt,
  type ConversationAcceptance
} from './assistant-conversation.ts'

const attempt: ConversationAttempt = {
  id: 'answer',
  questionId: 'question',
  createdAt: '2026-09-15T12:00:00.000Z',
  deadline: 600_000,
  status: 'Interrupted',
  reason: 'provider',
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
const acceptance: ConversationAcceptance = {
  question: {
    id: 'question',
    text: 'Explain this workspace',
    createdAt: attempt.createdAt,
    taskId: null
  },
  attempt,
  joined: false
}

describe('conversation admission', () => {
  it.effect(
    'joins a terminal delivery before considering a different active answer',
    () =>
      Effect.gen(function* () {
        const result = yield* admitConversationOperation({
          payloadHash: 'same',
          previous: { payloadHash: 'same', acceptance },
          active: { ...attempt, id: 'another', status: 'Running' }
        })
        expect(result?.attempt.id).toBe('answer')
        expect(result?.joined).toBe(true)
      })
  )
  it.effect('refuses different input under an accepted key', () =>
    Effect.gen(function* () {
      const result = yield* admitConversationOperation({
        payloadHash: 'changed',
        previous: { payloadHash: 'same', acceptance },
        active: null
      }).pipe(Effect.flip)
      expect(result.reason).toBe('idempotency_key_reused')
    })
  )
  it.effect('refuses a distinct send while running', () =>
    Effect.gen(function* () {
      const result = yield* admitConversationOperation({
        payloadHash: 'new',
        previous: null,
        active: { ...attempt, status: 'Running' }
      }).pipe(Effect.flip)
      expect(result.reason).toBe('busy')
    })
  )
  it.effect('refuses retry after a newer attempt completed the same question', () =>
    Effect.gen(function* () {
      const result = yield* admitConversationOperation({
        payloadHash: 'new',
        previous: null,
        active: null,
        retry: {
          target: attempt,
          latestQuestionId: 'question',
          latestAttemptId: 'completed-answer'
        }
      }).pipe(Effect.flip)
      expect(result.reason).toBe('stale_retry')
    })
  )

  it('canonicalizes absent task references and preserves question content', () => {
    expect(
      canonicalConversationOperation({ idempotencyKey: 'a', question: 'Hello' })
    ).toBe('["send","Hello",null]')
    expect(
      canonicalConversationOperation({ idempotencyKey: 'b', question: 'Hello ' })
    ).not.toBe('["send","Hello",null]')
  })
})

describe('conversation history pages', () => {
  const questions = Array.from({ length: 31 }, (_, index) => ({
    ...acceptance.question,
    id: `question-${index}`
  }))
  const attempts: ReadonlyArray<ConversationAttempt> = [
    {
      ...attempt,
      id: 'stopped',
      questionId: 'question-30',
      status: 'Stopped' satisfies ConversationAttempt['status']
    },
    {
      ...attempt,
      id: 'completed',
      questionId: 'question-30',
      status: 'Completed' satisfies ConversationAttempt['status']
    }
  ]
  const input = {
    questions,
    attempts,
    text: (id: string) => `${id} text`,
    cursor: null,
    full: false,
    policyRevision: 4
  }

  it('groups every attempt with its question and pages whole exchanges in chronological order', () => {
    const page = conversationHistoryPage(input)
    expect(page.items).toHaveLength(30)
    expect(page.items[0]?.question.id).toBe('question-1')
    expect(
      page.items[29]?.attempts.map((answer) => [answer.status, answer.text])
    ).toEqual([
      ['Stopped', 'stopped text'],
      ['Completed', 'completed text']
    ])
    expect(page.nextCursor).toBe('question-1')
    const older = conversationHistoryPage({ ...input, cursor: page.nextCursor })
    expect(older.items.map((item) => item.question.id)).toEqual(['question-0'])
    expect(older.nextCursor).toBeNull()
  })

  it('returns an empty page for an unknown cursor', () => {
    expect(conversationHistoryPage({ ...input, cursor: 'missing' })).toEqual({
      items: [],
      nextCursor: null,
      policyRevision: 4
    })
  })

  it('exports every exchange regardless of cursor and handles an empty conversation', () => {
    expect(
      conversationHistoryPage({ ...input, full: true, cursor: 'missing' }).items
    ).toHaveLength(31)
    expect(conversationHistoryPage({ ...input, questions: [] }).items).toEqual([])
  })
})
