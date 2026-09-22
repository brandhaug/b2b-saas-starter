import { Effect, Encoding, Schema } from 'effect'
import {
  ConversationUnavailable,
  type conversationHistoryPage
} from './assistant-conversation.ts'

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Json))

/** Run against each transport with a completed answer, using only its public SSE response. */
export const conversationObservationContract = Effect.fn(
  'ConversationObservation.contract'
)(function* <E, R>(input: {
  readonly conversationId: string
  readonly history: ReturnType<typeof conversationHistoryPage>
  readonly observe: (
    lastEventId: string
  ) => Effect.Effect<
    { text(): Promise<string>; readonly headers: { get(name: string): string | null } },
    E,
    R
  >
  readonly expect: (value: string | null) => {
    toContain(value: string | null): void
    toBe(value: string | null): void
    not: { toContain(value: string | null): void }
  }
}) {
  const attempt = input.history.items[0]?.attempts[0]
  if (attempt === undefined) {
    return yield* Effect.fail(new ConversationUnavailable({ reason: 'storage' }))
  }
  const attemptId = attempt.id
  function cursor(conversationId: string, revision: number) {
    return Encoding.encodeBase64(
      encodeJson([conversationId, attemptId, revision, 1, 'Running'])
    )
  }
  const response = yield* input.observe(
    cursor(input.conversationId, input.history.policyRevision)
  )
  const text = yield* Effect.promise(() => response.text())
  input.expect(text).toContain('id: ')
  input.expect(text).toContain('event: text')
  input.expect(text).toContain(
    encodeJson({
      attemptId: attempt.id,
      delta: attempt.text.slice(1),
      policyRevision: input.history.policyRevision
    })
  )
  input.expect(text).toContain('event: state')
  input.expect(text).toContain('event: terminal')
  input.expect(text).not.toContain('event: snapshot')
  input.expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  for (const expired of [
    'expired',
    cursor('another-conversation', input.history.policyRevision),
    cursor(input.conversationId, input.history.policyRevision + 1)
  ]) {
    const snapshot = yield* input.observe(expired)
    const body = yield* Effect.promise(() => snapshot.text())
    input.expect(body).toContain('event: snapshot')
    input.expect(body).toContain(encodeJson(attempt.text))
    input.expect(body).toContain('event: terminal')
  }
})
