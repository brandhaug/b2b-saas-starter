import { Clock, DateTime, Effect, Metric, Schedule, Schema } from 'effect'
import { CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'
import { randomHex } from './crypto.ts'
import {
  EmailDelivery,
  type ClaimEmail,
  type EmailCompletionDecision,
  type EmailDeliveryRecord,
  type EmailProviderEvent,
  type SendOutcome
} from './email-delivery.ts'

export type StoredDelivery = EmailDeliveryRecord & {
  readonly token: string | null
  readonly revision: number
}
/** Internal persistence seam: every replacement is compare-and-swap. */
export type DeliveryStore = {
  readonly get: (
    id: string
  ) => Effect.Effect<StoredDelivery | null, CapabilityUnavailable>
  readonly list: (filter: {
    readonly userId?: string
    readonly workspaceId?: string
    readonly messageId?: string
    readonly recipient?: string
    readonly referenceId?: string
    readonly purpose?: ClaimEmail['purpose']
    /** null reads the complete personal archive; omitted keeps the history limit. */
    readonly limit?: number | null
  }) => Effect.Effect<ReadonlyArray<StoredDelivery>, CapabilityUnavailable>
  readonly put: (
    row: StoredDelivery,
    previousRevision: number | null
  ) => Effect.Effect<boolean, CapabilityUnavailable>
  readonly resolveUserId: (
    email: string
  ) => Effect.Effect<string | null, CapabilityUnavailable>
}
const hour = 3_600_000
const lease = 5 * 60_000
const outcomes = Metric.counter('starter.email.send.outcomes')
function iso(time: number) {
  return DateTime.formatIso(DateTime.makeUnsafe(time))
}
function terminal(row: StoredDelivery) {
  return (
    row.acceptedAt !== null ||
    ['delivered', 'failed', 'suppressed', 'logged'].includes(row.status)
  )
}
function evidence({
  token: _token,
  revision: _revision,
  ...row
}: StoredDelivery): EmailDeliveryRecord {
  return row
}
function retryDuration(purpose: ClaimEmail['purpose']) {
  if (purpose === 'notification') {
    return 24 * hour
  }
  if (purpose === 'digest') {
    return 6 * hour
  }
  return 0
}
function reasonRank(reason: string | null): number {
  if (reason === 'complaint') {
    return 4
  }
  if (reason === 'hard_bounce') {
    return 3
  }
  if (reason === 'provider_suppressed') {
    return 2
  }
  if (reason === 'provider_rejected') {
    return 1
  }
  return 0
}

/**
 * A lost compare-and-swap. Private to `casRetry`: a mutation that sees it
 * re-reads the row and decides again, so it never reaches a caller.
 */
// oxlint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is a curried factory call, not an un-new-ed error constructor
class Contended extends Schema.TaggedError<Contended>()('Contended', {}) {}

/**
 * The read-decide-write loop every mutation runs. `step` re-reads the row and
 * fails with `Contended` when its `put` lost the revision race. Eight attempts
 * without a win is a capability failure: the decision was never applied.
 */
function casRetry<A, R>(
  reason: string,
  step: Effect.Effect<A, Contended | CapabilityUnavailable, R>
): Effect.Effect<A, CapabilityUnavailable, R> {
  return step.pipe(
    Effect.retry({
      while: (error) => error._tag === 'Contended',
      schedule: Schedule.recurs(7)
    }),
    Effect.catchTag('Contended', () =>
      Effect.fail(new CapabilityUnavailable({ capability: 'EmailDelivery', reason }))
    )
  )
}

export function makeEmailDelivery(store: DeliveryStore): EmailDelivery['Service'] {
  const claim = Effect.fn('EmailDelivery.claim')(function* (input: ClaimEmail) {
    const now = yield* Clock.currentTimeMillis
    let created = now
    if (input.queuedAt !== undefined) {
      created = Date.parse(input.queuedAt)
    }
    const retryWindow = retryDuration(input.purpose)
    if (!Number.isFinite(created)) {
      return null
    }
    const old = yield* store.get(input.id)
    if (old && terminal(old)) {
      return null
    }
    if (
      old &&
      (old.recipient !== input.recipient.toLowerCase().trim() ||
        old.userId !== input.userId ||
        old.workspaceId !== input.workspaceId ||
        old.purpose !== input.purpose)
    ) {
      return null
    }
    if (old && old.nextAttemptAt > iso(now)) {
      return null
    }
    if (old && old.retryUntil <= iso(now)) {
      yield* store.put(
        {
          ...old,
          revision: old.revision + 1,
          status: 'failed',
          reason: 'retry_window_expired',
          token: null,
          updatedAt: iso(now)
        },
        old.revision
      )
      return null
    }
    const token = randomHex(16)
    let row: StoredDelivery = {
      id: input.id,
      purpose: input.purpose,
      userId: input.userId,
      workspaceId: input.workspaceId,
      referenceId: input.referenceId ?? null,
      recipient: input.recipient.toLowerCase().trim(),
      token,
      revision: 0,
      status: 'queued',
      providerMessageId: null,
      lastEventId: null,
      lastEventAt: null,
      reason: null,
      acceptedAt: null,
      createdAt: iso(created),
      updatedAt: iso(now),
      attemptCount: 1,
      uncertain: false,
      retryUntil: iso(created + retryWindow),
      nextAttemptAt: iso(now + lease)
    }
    if (old) {
      row = {
        ...old,
        token,
        revision: old.revision + 1,
        attemptCount: old.attemptCount + 1,
        uncertain: old.uncertain || old.token !== null,
        nextAttemptAt: iso(now + lease),
        updatedAt: iso(now)
      }
    }
    if (retryWindow > 0 && created + retryWindow <= now) {
      yield* store.put(
        { ...row, status: 'failed', reason: 'retry_window_expired', token: null },
        old?.revision ?? null
      )
      return null
    }
    if (yield* store.put(row, old?.revision ?? null)) {
      return { token }
    }
    return null
  })
  const recordOutcome = Effect.fn('EmailDelivery.recordOutcome')(function* (
    id: string,
    token: string,
    outcome: SendOutcome
  ) {
    // A competing event wins the CAS; retry against that event without regressing it.
    return yield* casRetry(
      'Concurrent delivery updates exhausted the persistence attempt limit',
      Effect.gen(function* () {
        const old = yield* store.get(id)
        if (!old) {
          return
        }
        if (old.acceptedAt !== null || old.status === 'logged') {
          return
        }
        // A late transport receipt proves submission even after another claim took
        // the lease. Only failed/ambiguous outcomes remain fenced to their attempt.
        const confirmed = outcome.status === 'accepted' || outcome.status === 'logged'
        if (!confirmed && (old.token !== token || terminal(old))) {
          return
        }
        const now = yield* Clock.currentTimeMillis
        let status = outcome.status
        if (status === 'temporary_failure' && retryDuration(old.purpose) === 0) {
          status = 'failed'
        }
        let acceptedAt: string | null = old.acceptedAt
        let providerMessageId = old.providerMessageId
        let reason: string | null = null
        let delay = Math.min(hour, 60_000 * 2 ** Math.min(old.attemptCount - 1, 6))
        if (outcome.status === 'accepted') {
          acceptedAt = iso(now)
          providerMessageId = outcome.providerMessageId
        }
        if ('reason' in outcome) {
          reason = outcome.reason
        }
        if (outcome.status === 'ambiguous') {
          delay = lease
        }
        const row: StoredDelivery = {
          ...old,
          token: null,
          revision: old.revision + 1,
          status,
          updatedAt: iso(now),
          acceptedAt,
          providerMessageId,
          reason,
          uncertain:
            old.uncertain ||
            outcome.status === 'ambiguous' ||
            (confirmed && old.token !== token),
          nextAttemptAt: iso(now + delay)
        }
        if (yield* store.put(row, old.revision)) {
          return
        }
        return yield* Effect.fail(new Contended())
      })
    )
  })
  const completionDecision = Effect.fn('EmailDelivery.completionDecision')(function* (
    id: string
  ) {
    const record = yield* store.get(id)
    if (
      record === null ||
      !['queued', 'temporary_failure', 'ambiguous'].includes(record.status)
    ) {
      return {
        outcome: 'ack',
        status: record?.status ?? 'skipped'
      } satisfies EmailCompletionDecision
    }
    const now = yield* Clock.currentTimeMillis
    const due = Math.min(
      Date.parse(record.nextAttemptAt),
      Date.parse(record.retryUntil)
    )
    return {
      outcome: 'retry_pending',
      status: record.status,
      retryAfterSeconds: Math.max(1, Math.ceil((due - now) / 1000))
    } satisfies EmailCompletionDecision
  })
  const applyProviderEvent = Effect.fn('EmailDelivery.applyProviderEvent')(function* (
    event: EmailProviderEvent
  ) {
    const matches = yield* store.list({
      messageId: event.messageId,
      recipient: event.recipient.toLowerCase().trim()
    })
    const match = matches[0]
    if (!match) {
      return 'unmatched'
    }
    return yield* casRetry(
      'Concurrent delivery events exhausted the persistence attempt limit',
      Effect.gen(function* () {
        const old = yield* store.get(match.id)
        if (!old || old.lastEventId === event.eventId) {
          return 'ignored'
        }
        // Complaints/suppression may follow delivery. Lesser evidence cannot erase them.
        const rank = {
          queued: 0,
          ambiguous: 0,
          temporary_failure: 0,
          accepted: 1,
          logged: 1,
          delayed: 2,
          delivered: 3,
          failed: 4,
          suppressed: 5
        }
        if (rank[event.status] < rank[old.status]) {
          return 'ignored'
        }
        const now = yield* Clock.currentTimeMillis
        let reason: string | null = event.reason ?? null
        if (reason === null && event.status === 'failed') {
          reason = 'provider_rejected'
        }
        if (reason === null && event.status === 'suppressed') {
          reason = 'provider_suppressed'
        }
        if (
          rank[event.status] === rank[old.status] &&
          reasonRank(reason) <= reasonRank(old.reason)
        ) {
          return 'ignored'
        }
        if (reasonRank(old.reason) > reasonRank(reason)) {
          reason = old.reason
        }
        const row: StoredDelivery = {
          ...old,
          status: event.status,
          acceptedAt: old.acceptedAt ?? iso(now),
          updatedAt: iso(now),
          lastEventId: event.eventId,
          lastEventAt: event.occurredAt,
          revision: old.revision + 1,
          reason
        }
        if (yield* store.put(row, old.revision)) {
          return 'updated'
        }
        return yield* Effect.fail(new Contended())
      })
    )
  })
  const abandon = Effect.fn('EmailDelivery.abandon')(function* (
    id: string,
    reason = 'no_longer_relevant'
  ) {
    return yield* casRetry(
      'Concurrent delivery updates prevented cancellation',
      Effect.gen(function* () {
        const old = yield* store.get(id)
        if (!old || terminal(old)) {
          return
        }
        const now = yield* Clock.currentTimeMillis
        if (
          yield* store.put(
            {
              ...old,
              status: 'failed',
              reason,
              revision: old.revision + 1,
              updatedAt: iso(now)
            },
            old.revision
          )
        ) {
          return
        }
        return yield* Effect.fail(new Contended())
      })
    )
  })
  const listForUser = Effect.fn('EmailDelivery.listForUser')(function* (
    userId: string,
    options?: { readonly complete?: boolean }
  ) {
    // The complete personal archive drops the history page limit; the account
    // history page keeps it.
    if (options?.complete === true) {
      return (yield* store.list({ userId, limit: null })).map(evidence)
    }
    return (yield* store.list({ userId })).map(evidence)
  })
  const listInvitations = Effect.fn('EmailDelivery.listInvitations')(function* (
    workspaceId: string
  ) {
    return (yield* store.list({
      workspaceId,
      purpose: 'invitation'
    })).map(evidence)
  })
  const latestInvitation = Effect.fn('EmailDelivery.latestInvitation')(function* (
    workspaceId: string,
    referenceId: string
  ) {
    const rows = yield* store.list({
      workspaceId,
      purpose: 'invitation',
      referenceId,
      limit: 1
    })
    if (rows[0]) {
      return evidence(rows[0])
    }
    return null
  })
  const listSystem = Effect.fn('EmailDelivery.listSystem')(function* () {
    return (yield* store.list({})).map(evidence)
  })
  const get = Effect.fn('EmailDelivery.get')(function* (id: string) {
    const row = yield* store.get(id)
    if (row) {
      return evidence(row)
    }
    return null
  })
  const trackedAttempt: EmailDelivery['Service']['trackedAttempt'] = Effect.fn(
    'EmailDelivery.trackedAttempt'
  )(function* <A extends SendOutcome, E, R>(
    input: ClaimEmail,
    attempt: Effect.Effect<A, E, R>,
    classifyFailure: (error: E) => SendOutcome
  ) {
    const claimed = yield* claim(input)
    if (claimed === null) {
      return { status: 'skipped' } satisfies { status: 'skipped' }
    }
    const token = claimed.token
    function record(outcome: SendOutcome) {
      return recordOutcome(input.id, token, outcome).pipe(
        Effect.andThen(
          Metric.update(
            Metric.withAttributes(outcomes, {
              purpose: input.purpose,
              status: outcome.status
            }),
            1
          )
        )
      )
    }
    const outcome = yield* attempt.pipe(
      Effect.tapError((error) => record(classifyFailure(error)))
    )
    yield* record(outcome)
    return { status: outcome.status }
  })
  return EmailDelivery.of({
    trackedAttempt,
    completionDecision,
    claim,
    recordOutcome,
    abandon,
    applyProviderEvent,
    get,
    listForUser,
    listInvitations,
    latestInvitation,
    listSystem,
    resolveUserId: store.resolveUserId
  })
}
