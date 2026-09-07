import { Clock, DateTime, Effect } from 'effect'
import { randomHex } from '../crypto.ts'
import { CapabilityUnavailable } from '../errors.ts'
import { WorkspaceContext } from '../workspace-context.ts'
import {
  EmailDelivery,
  type ClaimEmail,
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
    readonly statuses?: ReadonlyArray<EmailDeliveryRecord['status']>
    readonly createdBefore?: string
    readonly limit?: number
  }) => Effect.Effect<ReadonlyArray<StoredDelivery>, CapabilityUnavailable>
  readonly put: (
    row: StoredDelivery,
    previousRevision: number | null
  ) => Effect.Effect<boolean, CapabilityUnavailable>
  readonly remove: (
    rows: ReadonlyArray<StoredDelivery>
  ) => Effect.Effect<number, CapabilityUnavailable>
  readonly resolveUserId: (
    email: string
  ) => Effect.Effect<string | null, CapabilityUnavailable>
}
const hour = 3_600_000
const lease = 5 * 60_000
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
    for (let attempt = 0; attempt < 8; attempt++) {
      const old = yield* store.get(id)
      if (!old || old.token !== token || terminal(old)) {
        return
      }
      const now = yield* Clock.currentTimeMillis
      let status = outcome.status
      if (status === 'temporary_failure' && retryDuration(old.purpose) === 0) {
        status = 'failed'
      }
      let acceptedAt = old.acceptedAt
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
        uncertain: old.uncertain || outcome.status === 'ambiguous',
        nextAttemptAt: iso(now + delay)
      }
      if (yield* store.put(row, old.revision)) {
        return
      }
    }
    return yield* Effect.fail(
      new CapabilityUnavailable({
        capability: 'EmailDelivery',
        reason: 'Concurrent delivery updates exhausted the persistence attempt limit'
      })
    )
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
    for (let attempt = 0; attempt < 8; attempt++) {
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
      if (rank[event.status] <= rank[old.status]) {
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
    }
    return yield* Effect.fail(
      new CapabilityUnavailable({
        capability: 'EmailDelivery',
        reason: 'Concurrent delivery events exhausted the persistence attempt limit'
      })
    )
  })
  const listForUser = Effect.fn('EmailDelivery.listForUser')(function* (
    userId: string
  ) {
    return (yield* store.list({ userId })).map(evidence)
  })
  const listInvitations = Effect.fn('EmailDelivery.listInvitations')(function* () {
    const context = yield* WorkspaceContext
    return (yield* store.list({
      workspaceId: context.workspace.id,
      purpose: 'invitation'
    })).map(evidence)
  })
  const latestInvitation = Effect.fn('EmailDelivery.latestInvitation')(function* (
    referenceId: string
  ) {
    const context = yield* WorkspaceContext
    const rows = yield* store.list({
      workspaceId: context.workspace.id,
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
  const prune = Effect.fn('EmailDelivery.prune')(function* () {
    const now = yield* Clock.currentTimeMillis
    const normal = yield* store.list({
      statuses: ['queued', 'accepted', 'delivered', 'logged'],
      createdBefore: iso(now - 30 * 24 * hour),
      limit: 250
    })
    const unresolved = yield* store.list({
      statuses: ['failed', 'suppressed', 'ambiguous', 'temporary_failure', 'delayed'],
      createdBefore: iso(now - 90 * 24 * hour),
      limit: 250
    })
    return yield* store.remove([...normal, ...unresolved])
  })
  return EmailDelivery.of({
    claim,
    recordOutcome,
    applyProviderEvent,
    get,
    listForUser,
    listInvitations,
    latestInvitation,
    listSystem,
    prune,
    resolveUserId: store.resolveUserId
  })
}
