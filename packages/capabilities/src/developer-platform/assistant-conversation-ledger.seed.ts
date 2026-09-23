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
    questions: (page) =>
      Effect.sync(() => {
        const all = [...questions.values()]
        if (page === undefined) {
          return all
        }
        let end = all.length
        if (page.before !== null) {
          end = all.findIndex((question) => question.id === page.before)
        }
        if (end < 0) {
          return []
        }
        return all.slice(Math.max(0, end - page.limit), end)
      }),
    attempts: (questionIds) =>
      Effect.sync(() => {
        let selected: Set<string> | null = null
        if (questionIds !== undefined) {
          selected = new Set(questionIds)
        }
        return [...attempts.values()].filter(
          (attempt) => selected === null || selected.has(attempt.questionId)
        )
      }),
    firstQuestion: () => Effect.sync(() => questions.values().next().value ?? null),
    recentFailures: () =>
      Effect.sync(() =>
        [...attempts.values()]
          .filter(
            (attempt) =>
              attempt.status === 'Interrupted' || attempt.status === 'Stopped'
          )
          .slice(-3)
      ),
    completedCount: () =>
      Effect.sync(() => {
        const completed = new Set<string>()
        for (const attempt of attempts.values()) {
          if (attempt.status === 'Completed') {
            completed.add(attempt.questionId)
          }
        }
        return completed.size
      }),
    completed: (page) =>
      Effect.sync(() => {
        const all = [...questions.values()]
        let end = all.length
        if (page.before !== null) {
          end = all.findIndex((question) => question.id === page.before)
        }
        if (end < 0) {
          return []
        }
        const completed = new Map<string, ConversationAttempt>()
        for (const attempt of attempts.values()) {
          if (attempt.status === 'Completed' && !completed.has(attempt.questionId)) {
            completed.set(attempt.questionId, attempt)
          }
        }
        return all
          .slice(0, end)
          .flatMap((question) => {
            const attempt = completed.get(question.id)
            if (attempt === undefined) {
              return []
            }
            return [{ question, attempt }]
          })
          .slice(-page.limit)
      }),
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
