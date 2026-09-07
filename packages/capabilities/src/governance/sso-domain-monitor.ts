import { workspaceSsoDomainClaims } from '@b2b-saas-starter/db/schema'
import { type SsoDomainVerificationStatus } from '@b2b-saas-starter/db/enums'
import { Database } from '@b2b-saas-starter/db/service'
import { and, eq } from 'drizzle-orm'
import { DateTime, Effect } from 'effect'
import { hashSha256 } from '../crypto.ts'
import { orUnavailable } from '../internal/unavailable.ts'
import { NotificationFeed } from '../notifications/notification-feed.ts'
import { AuditEventLog } from './audit-event-log.ts'
import { auditedMutations } from './audited-mutation.ts'
import { domainGraceExpiry } from './sso-policy.ts'

/** A failed DNS answer starts one grace period; retries cannot extend it. */
export const checkSsoDomains = Effect.fn('SsoDomains.checkDaily')(function* (
  resolveTxt: (name: string) => Promise<ReadonlyArray<ReadonlyArray<string>>>
) {
  const db = yield* Database
  const audit = yield* AuditEventLog
  const feed = yield* NotificationFeed
  const unavailable = orUnavailable('sso-domain-verification')
  const mutate = yield* auditedMutations({
    prepareAuditRecord: audit.prepareRecord,
    unavailable
  })
  const now = DateTime.formatIso(yield* DateTime.now)
  const claims = yield* unavailable(db.select().from(workspaceSsoDomainClaims))
  for (const claim of claims) {
    if (claim.status === 'pending') {
      continue
    }
    const recordName = `_better-auth-token-${claim.providerId}.${claim.domain}`
    const records = yield* Effect.tryPromise(() => resolveTxt(recordName)).pipe(
      Effect.catch(() => Effect.succeed([]))
    )
    const hashes = yield* Effect.forEach(records, (record) => {
      let text = record.join('').trim()
      const prefix = `_better-auth-token-${claim.providerId}=`
      if (text.startsWith(prefix)) {
        text = text.slice(prefix.length)
      }
      return Effect.promise(() => hashSha256(text))
    })
    const verified = hashes.includes(claim.verificationTokenHash)
    let graceUntil: string | null = null
    let status: SsoDomainVerificationStatus = 'verified'
    let verifiedAt: string | null = now
    if (!verified) {
      graceUntil = claim.graceUntil ?? domainGraceExpiry(now)
      status = 'failed'
      if (now < graceUntil) {
        status = 'grace'
      }
      verifiedAt = claim.verifiedAt
    }
    yield* mutate({
      matched: Effect.succeed(true),
      auditEvent: {
        workspaceId: claim.workspaceId,
        actorType: 'system',
        eventType: 'workspace_sso.connection_updated',
        targetType: 'workspace_sso_connection',
        targetId: claim.providerId,
        metadata: { domain: claim.domain, verificationStatus: status, graceUntil }
      },
      write: () =>
        db
          .update(workspaceSsoDomainClaims)
          .set({ status, graceUntil, lastCheckedAt: now, updatedAt: now, verifiedAt })
          .where(
            and(
              eq(workspaceSsoDomainClaims.id, claim.id),
              eq(workspaceSsoDomainClaims.providerId, claim.providerId),
              eq(
                workspaceSsoDomainClaims.verificationTokenHash,
                claim.verificationTokenHash
              ),
              eq(workspaceSsoDomainClaims.updatedAt, claim.updatedAt)
            )
          )
    })
    // Retried daily while unhealthy, including when a previous notice failed.
    if (!verified || claim.status !== 'verified') {
      yield* feed.notifyWorkspaceOwners({
        workspaceId: claim.workspaceId,
        kind: 'announcement',
        title: 'SSO domain verification',
        message: `Domain verification for ${claim.domain}: ${status}. Required SSO remains enforced.`,
        event: {
          type: 'sso.domain_verification',
          domain: claim.domain,
          status,
          graceUntil: graceUntil ?? now
        }
      })
    }
  }
})
