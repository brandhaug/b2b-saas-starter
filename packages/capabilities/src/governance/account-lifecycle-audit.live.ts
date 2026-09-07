import { batch, Database, RawD1 } from '@b2b-saas-starter/db/service'
import { auditEvents, type JsonValue } from '@b2b-saas-starter/db/schema'
import { Effect } from 'effect'
import { and, asc, eq, gt, or, sql } from 'drizzle-orm'

import { type CapabilityUnavailable } from '../errors.ts'
import { orUnavailable } from '../internal/unavailable.ts'
import { decodeAuditEventMetadata } from './audit-event-metadata.ts'

// oxlint-disable anti-slop/no-runtime-typeof -- persisted JSON has already crossed Drizzle's typed boundary; this recursive walk only finds an exact email value before the allowlist decoder runs.
function metadataContainsExactEmail(value: JsonValue, email: string): boolean {
  if (typeof value === 'string') {
    return value === email
  }
  if (Array.isArray(value)) {
    return value.some((entry) => metadataContainsExactEmail(entry, email))
  }
  if (value !== null && typeof value === 'object') {
    return Object.values(value).some((entry) =>
      metadataContainsExactEmail(entry, email)
    )
  }
  return false
}
// oxlint-enable anti-slop/no-runtime-typeof

/**
 * Scrubs retained audit rows for a deleted account in bounded D1 pages.
 * Actor/target ids are indexed identity references; metadata is narrowed by
 * SQLite's text search and then checked recursively for an exact email value.
 */
export function scrubAuditEventsForAccount(account: {
  readonly id: string
  readonly email: string
}): Effect.Effect<void, CapabilityUnavailable, Database | RawD1> {
  const unavailable = orUnavailable('account-lifecycle')
  return Effect.gen(function* () {
    const db = yield* Database
    const d1 = yield* RawD1
    const auditPageSize = 100
    let lastAuditId: string | undefined
    let hasMoreAuditRows = true
    while (hasMoreAuditRows) {
      const auditPredicate = or(
        eq(auditEvents.actorUserId, account.id),
        eq(auditEvents.targetId, account.id),
        sql`instr(${auditEvents.metadata}, ${account.email}) > 0`
      )
      let auditWhere = auditPredicate
      if (lastAuditId !== undefined) {
        auditWhere = and(gt(auditEvents.id, lastAuditId), auditPredicate)
      }
      const auditRows = yield* unavailable(
        db
          .select({
            id: auditEvents.id,
            actorUserId: auditEvents.actorUserId,
            targetId: auditEvents.targetId,
            metadata: auditEvents.metadata
          })
          .from(auditEvents)
          .where(auditWhere)
          .orderBy(asc(auditEvents.id))
          .limit(auditPageSize)
      )
      if (auditRows.length === 0) {
        break
      }
      const statements = []
      for (const row of auditRows) {
        const attributed = row.actorUserId === account.id
        const containsEmail = metadataContainsExactEmail(row.metadata, account.email)
        if (!attributed && row.targetId !== account.id && !containsEmail) {
          continue
        }
        const nextMetadata = decodeAuditEventMetadata(row.metadata)
        let actorUserId = row.actorUserId
        if (attributed) {
          actorUserId = null
        }
        statements.push(
          db
            .update(auditEvents)
            .set({ actorUserId, metadata: nextMetadata })
            .where(eq(auditEvents.id, row.id))
        )
      }
      if (statements.length > 0) {
        yield* unavailable(batch(statements).pipe(Effect.provideService(RawD1, d1)))
      }
      lastAuditId = auditRows.at(-1)?.id
      hasMoreAuditRows = auditRows.length === auditPageSize
    }
  })
}
