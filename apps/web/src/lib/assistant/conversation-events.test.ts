import { expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import {
  observeConversationAttempt,
  type AttemptSnapshot
} from '@b2b-saas-starter/capabilities/developer-platform/assistant-conversation-events'

const snapshot: AttemptSnapshot = {
  question: {
    id: 'question',
    text: 'Explain',
    taskId: null,
    createdAt: '2026-09-15T00:00:00.000Z'
  },
  attempt: {
    id: 'attempt',
    questionId: 'question',
    text: 'Saved answer',
    status: 'Completed',
    reason: null,
    createdAt: '2026-09-15T00:00:00.000Z',
    completedAt: '2026-09-15T00:00:01.000Z',
    deadline: 600_000,
    provider: null,
    modelId: null,
    providerRequestId: null,
    finishReason: 'stop',
    inputTokens: null,
    outputTokens: null,
    omittedExchanges: 0,
    evidence: null
  },
  policyRevision: 2
}

it.effect(
  'replays only the suffix after a valid cursor and includes the terminal state',
  () =>
    Effect.gen(function* () {
      const id = btoa(JSON.stringify(['conversation', 'attempt', 2, 6, 'Running']))
      const response = yield* observeConversationAttempt(
        'conversation',
        Effect.succeed(snapshot),
        id
      )
      const body = yield* Effect.promise(() => response.text())
      expect(body).toContain('event: text')
      expect(body).toContain('"delta":"answer"')
      expect(body).toContain('event: state')
      expect(body).toContain('event: terminal')
      expect(body).not.toContain('event: snapshot')
    })
)

for (const [name, cursor] of [
  ['missing', null],
  ['malformed base64', '!'],
  ['malformed JSON', btoa('invalid')],
  ['foreign conversation', btoa(JSON.stringify(['other', 'attempt', 2, 6, 'Running']))],
  ['foreign attempt', btoa(JSON.stringify(['conversation', 'other', 2, 6, 'Running']))],
  [
    'obsolete permission revision',
    btoa(JSON.stringify(['conversation', 'attempt', 1, 6, 'Running']))
  ],
  [
    'lost unsaved tail',
    btoa(JSON.stringify(['conversation', 'attempt', 2, 99, 'Running']))
  ]
] satisfies ReadonlyArray<readonly [string, string | null]>) {
  it.effect(`falls back to saved authoritative history for a ${name} cursor`, () =>
    Effect.gen(function* () {
      const response = yield* observeConversationAttempt(
        'conversation',
        Effect.succeed(snapshot),
        cursor
      )
      const body = yield* Effect.promise(() => response.text())
      expect(body).toContain('event: snapshot')
      expect(body).toContain('Saved answer')
    })
  )
}

it.effect('checks current access before disclosing replay content', () =>
  Effect.gen(function* () {
    const id = btoa(JSON.stringify(['conversation', 'attempt', 2, 6, 'Running']))
    const response = yield* observeConversationAttempt(
      'conversation',
      Effect.fail('revoked'),
      id
    )
    const body = yield* Effect.promise(() => response.text())
    expect(body).toContain('access_unavailable')
    expect(body).not.toContain('Saved answer')
  })
)
