import {
  verification,
  workspaceSsoConnections,
  workspaceSsoDomainClaims
} from '@b2b-saas-starter/db/schema'
import { Database } from '@b2b-saas-starter/db/service'
import { and, eq } from 'drizzle-orm'
import { DateTime, Effect } from 'effect'
import { hashSha256 } from '../crypto.ts'
import { MembershipChangeRejected } from '../errors.ts'
import { newCapabilityId } from '../internal/ids.ts'
import { orUnavailable } from '../internal/unavailable.ts'
import { WorkspaceContext } from '../workspace-context.ts'
import { AuditEventLog } from './audit-event-log.ts'
import { auditedMutations } from './audited-mutation.ts'
import { makeBindingCaller } from './plugin-binding-failure.ts'
import { type WorkspaceSsoBinding } from './workspace-sso-connections.ts'
import { requireRecentSsoConfigurationAuth } from './sso-configuration-auth.ts'
import { type SsoPolicyOptions } from './sso-policy-config.ts'

const { callBinding } = makeBindingCaller<
  WorkspaceSsoBinding,
  MembershipChangeRejected
>({
  capability: 'sso-domain-verification',
  noBindingReason: 'no_sso_binding',
  Rejected: MembershipChangeRejected
})

/** Better Auth verifies DNS. The unique claim controls which workspace may use it. */
export const makeSsoDomainVerification = Effect.fn('SsoDomains.make')(function* (
  binding?: WorkspaceSsoBinding,
  options: SsoPolicyOptions = {}
) {
  const db = yield* Database
  const audit = yield* AuditEventLog
  const unavailable = orUnavailable('sso-domain-verification')
  const mutate = yield* auditedMutations({
    prepareAuditRecord: audit.prepareRecord,
    unavailable
  })

  const connection = Effect.fn('SsoDomains.connection')(function* (providerId: string) {
    yield* requireRecentSsoConfigurationAuth(db, options.configurationAuthRecencyMs)
    const ctx = yield* WorkspaceContext
    const [row] = yield* unavailable(
      db
        .select()
        .from(workspaceSsoConnections)
        .where(
          and(
            eq(workspaceSsoConnections.providerId, providerId),
            eq(workspaceSsoConnections.workspaceId, ctx.workspace.id)
          )
        )
        .limit(1)
    )
    if (!row) {
      return yield* new MembershipChangeRejected({ reason: 'connection_not_found' })
    }
    const [claim] = yield* unavailable(
      db
        .select()
        .from(workspaceSsoDomainClaims)
        .where(eq(workspaceSsoDomainClaims.domain, row.domain))
        .limit(1)
    )
    if (claim && claim.workspaceId !== ctx.workspace.id) {
      return yield* new MembershipChangeRejected({ reason: 'domain_claim_conflict' })
    }
    return { row, claim, ctx }
  })

  return {
    requestDomainVerification: Effect.fn('SsoDomains.requestVerification')(function* ({
      providerId
    }: {
      readonly providerId: string
    }) {
      const { row } = yield* connection(providerId)
      const challenge = yield* callBinding(binding, (bound) =>
        bound.requestDomainVerification({ providerId })
      )
      return {
        recordName: `_better-auth-token-${providerId}.${row.domain}`,
        recordValue: challenge.domainVerificationToken
      }
    }),
    verifyDomain: Effect.fn('SsoDomains.verify')(function* ({
      providerId
    }: {
      readonly providerId: string
    }) {
      const { row, claim, ctx } = yield* connection(providerId)
      const now = DateTime.formatIso(yield* DateTime.now)
      // Existing claims are rechecked by the DNS monitor, never refreshed from
      // the plugin's historical domainVerified flag.
      if (claim && row.domainVerified) {
        if (claim.status === 'pending') {
          return yield* new MembershipChangeRejected({
            reason: 'fresh_connection_verification_required'
          })
        }
        return
      }
      let token: string
      let checkedAt = now
      if (row.domainVerified) {
        // A previous plugin verification may have committed before the claim
        // write failed. Its retained, unexpired challenge permits a safe retry.
        const [pending] = yield* unavailable(
          db
            .select()
            .from(verification)
            .where(eq(verification.identifier, `_better-auth-token-${providerId}`))
            .limit(1)
        )
        if (!pending || pending.expiresAt.getTime() <= Date.parse(now)) {
          return yield* new MembershipChangeRejected({
            reason: 'domain_verification_retry_expired'
          })
        }
        token = pending.value
        checkedAt = pending.createdAt.toISOString()
      } else {
        const challenge = yield* callBinding(binding, (bound) =>
          bound.requestDomainVerification({ providerId })
        )
        token = challenge.domainVerificationToken
        yield* callBinding(binding, (bound) => bound.verifyDomain({ providerId }))
      }
      const verificationTokenHash = yield* Effect.promise(() => hashSha256(token))
      const id = yield* newCapabilityId('sso_domain')
      const values = {
        providerId,
        verificationTokenHash,
        status: 'verified',
        verifiedAt: checkedAt,
        lastCheckedAt: checkedAt,
        graceUntil: null,
        updatedAt: now
      } satisfies Partial<typeof workspaceSsoDomainClaims.$inferInsert>
      yield* mutate({
        matched: Effect.succeed(true),
        auditEvent: {
          workspaceId: ctx.workspace.id,
          actorUserId: ctx.actor?.userId ?? null,
          actorType: ctx.actorType,
          eventType: 'workspace_sso.connection_updated',
          targetType: 'workspace_sso_connection',
          targetId: providerId,
          metadata: { domain: row.domain, domainVerified: true }
        },
        write: () => {
          if (claim) {
            return db
              .update(workspaceSsoDomainClaims)
              .set(values)
              .where(
                and(
                  eq(workspaceSsoDomainClaims.id, claim.id),
                  eq(workspaceSsoDomainClaims.workspaceId, ctx.workspace.id)
                )
              )
          }
          return db.insert(workspaceSsoDomainClaims).values({
            ...values,
            id,
            workspaceId: ctx.workspace.id,
            domain: row.domain,
            createdAt: now
          })
        }
      })
    })
  }
})
