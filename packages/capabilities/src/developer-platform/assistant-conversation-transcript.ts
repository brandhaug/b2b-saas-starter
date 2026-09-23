import { Effect } from 'effect'
import { ConversationModel } from '@b2b-saas-starter/ai/conversation'
import {
  type ConversationPrompt,
  type PreparedConversationPrompt
} from '@b2b-saas-starter/ai/conversation-context'
import {
  conversationHistoryPage,
  type ConversationAttempt,
  type ConversationQuestion,
  type ConversationUnavailable
} from './assistant-conversation.ts'

type Stored<A> = Effect.Effect<A, ConversationUnavailable>
export type TranscriptQuestionPage = {
  readonly before: string | null
  readonly limit: number
}
export type CompletedExchange = {
  readonly question: ConversationQuestion
  readonly attempt: ConversationAttempt
}

/** Storage owns selection; callers never load the transcript to choose a page. */
export type ConversationTranscript = {
  questions(page?: TranscriptQuestionPage): Stored<ReadonlyArray<ConversationQuestion>>
  attempts(
    questionIds?: ReadonlyArray<string>
  ): Stored<ReadonlyArray<ConversationAttempt>>
  completed(page: TranscriptQuestionPage): Stored<ReadonlyArray<CompletedExchange>>
  completedCount(): Stored<number>
  recentFailures(): Stored<ReadonlyArray<ConversationAttempt>>
  firstQuestion(): Stored<ConversationQuestion | null>
}

export const readConversationHistory = Effect.fn('ConversationTranscript.history')(
  function* (
    store: ConversationTranscript,
    input: {
      readonly cursor: string | null
      readonly full: boolean
      readonly policyRevision: number
      readonly text: (attemptId: string) => Stored<string>
    }
  ) {
    // One extra question determines whether another page exists. Full reads are export-only.
    let page: TranscriptQuestionPage | undefined
    if (!input.full) {
      page = { before: input.cursor, limit: 31 }
    }
    const questions = yield* store.questions(page)
    let selected = questions
    if (!input.full) {
      selected = questions.slice(-30)
    }
    const attempts = yield* store.attempts(selected.map((question) => question.id))
    const text = new Map(
      yield* Effect.forEach(attempts, (attempt) =>
        Effect.map(
          input.text(attempt.id),
          (value) => [attempt.id, value] satisfies [string, string]
        )
      )
    )
    return conversationHistoryPage({
      ...input,
      cursor: null,
      questions,
      attempts,
      text: (id) => text.get(id) ?? ''
    })
  }
)

export const prepareTranscriptContext = Effect.fn(
  'ConversationTranscript.prepareContext'
)(function* (
  store: ConversationTranscript,
  input: Omit<ConversationPrompt, 'history' | 'failureObservations'> & {
    readonly text: (attemptId: string) => Stored<string>
  }
) {
  const model = yield* ConversationModel
  const failures = yield* store.recentFailures()
  const failureObservations = failures.map(
    (attempt): NonNullable<ConversationPrompt['failureObservations']>[number] => {
      let reason: NonNullable<
        ConversationPrompt['failureObservations']
      >[number]['reason'] = 'interrupted'
      if (attempt.status === 'Stopped') {
        reason = 'stopped'
      } else if (attempt.reason === 'output_limit') {
        reason = 'output_limit'
      } else if (attempt.reason === 'provider') {
        reason = 'provider'
      }
      return { questionId: attempt.questionId, attemptId: attempt.id, reason }
    }
  )
  let before: string | null = null
  const history: Array<ConversationPrompt['history'][number]> = []
  let prepared: PreparedConversationPrompt
  let batchFull: boolean
  do {
    const batch: ReadonlyArray<CompletedExchange> = yield* store.completed({
      before,
      limit: 16
    })
    const older = yield* Effect.forEach(batch, ({ question, attempt }) =>
      Effect.map(
        input.text(attempt.id),
        (answer): ConversationPrompt['history'][number] => {
          const exchange = { questionId: question.id, question: question.text, answer }
          if (attempt.evidence !== null) {
            return { ...exchange, evidence: attempt.evidence }
          }
          return exchange
        }
      )
    )
    history.unshift(...older)
    let prompt: ConversationPrompt = {
      workspaceSlug: input.workspaceSlug,
      question: input.question,
      failureObservations,
      history
    }
    if (input.evidence !== undefined) {
      prompt = { ...prompt, evidence: input.evidence }
    }
    prepared = yield* model.prepare(prompt)
    if (prepared.omittedExchanges > 0) {
      return {
        ...prepared,
        omittedExchanges:
          prepared.omittedExchanges + (yield* store.completedCount()) - history.length
      }
    }
    batchFull = batch.length === 16
    before = batch[0]?.question.id ?? null
  } while (batchFull)
  return prepared
})
