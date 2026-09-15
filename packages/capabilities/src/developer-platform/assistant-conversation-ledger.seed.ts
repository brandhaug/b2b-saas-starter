import { Effect } from 'effect'
import {
  type ConversationAdmissionLedger,
  type ConversationExecution
} from './assistant-conversation-admission.ts'
import {
  activeConversationAttempt,
  ConversationUnavailable,
  type ConversationAttempt,
  type ConversationQuestion
} from './assistant-conversation.ts'

/** One isolated Seed conversation, with the same monotonic acceptance ledger as SQLite. */
export function makeSeedConversationLedger() {
  const questions = new Map<string, ConversationQuestion>()
  const attempts = new Map<string, ConversationAttempt>()
  const keys = new Map<string, { hash: string; attemptId: string }>()
  const executions = new Map<string, typeof ConversationExecution.Type>()
  const texts = new Map<string, string>()
  const ledger: ConversationAdmissionLedger = {
    latestAttempt: () => Effect.sync(() => [...attempts.values()].at(-1) ?? null),
    attempt: (id) => Effect.sync(() => attempts.get(id) ?? null),
    active: () =>
      Effect.sync(
        () => [...attempts.values()].findLast(activeConversationAttempt) ?? null
      ),
    question: (id) => Effect.sync(() => questions.get(id) ?? null),
    questions: () => Effect.sync(() => [...questions.values()]),
    attempts: () => Effect.sync(() => [...attempts.values()]),
    previous: (key) =>
      Effect.sync(() => {
        const saved = keys.get(key)
        if (saved === undefined) {
          return null
        }
        const attempt = attempts.get(saved.attemptId)
        if (attempt === undefined) {
          return null
        }
        const question = questions.get(attempt.questionId)
        if (question === undefined) {
          return null
        }
        return {
          payloadHash: saved.hash,
          acceptance: { question, attempt, joined: true }
        }
      }),
    accept: (input) =>
      Effect.gen(function* () {
        if (keys.has(input.key) || attempts.has(input.acceptance.attempt.id)) {
          return yield* new ConversationUnavailable({ reason: 'storage' })
        }
        questions.set(input.acceptance.question.id, input.acceptance.question)
        attempts.set(input.acceptance.attempt.id, input.acceptance.attempt)
        keys.set(input.key, {
          hash: input.hash,
          attemptId: input.acceptance.attempt.id
        })
        executions.set(input.acceptance.attempt.id, input.execution)
      }),
    update: (attempt) =>
      Effect.sync(() => {
        const current = attempts.get(attempt.id)
        if (current === undefined || !activeConversationAttempt(current)) {
          return false
        }
        attempts.set(attempt.id, attempt)
        return true
      })
  }
  const execution = Effect.fn('SeedConversation.execution')(function* (id: string) {
    const value = executions.get(id)
    if (value === undefined) {
      return yield* new ConversationUnavailable({ reason: 'storage' })
    }
    return value
  })
  return { ledger, execution, texts }
}
