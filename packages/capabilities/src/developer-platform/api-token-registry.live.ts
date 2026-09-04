import { apiTokens, workspaces } from '@b2b-saas-starter/db/schema'
import { Database, type RawD1 } from '@b2b-saas-starter/db/service'
import { DateTime, Effect, Layer } from 'effect'
import { and, desc, eq, isNull, type SQL } from 'drizzle-orm'

import { assertWithinPlanLimitFor } from '../billing/plan-catalog.ts'
import { AuthorizationDenied } from '../errors.ts'
import { randomHex } from '../internal/crypto.ts'
import { newCapabilityId } from '../internal/ids.ts'
import { clampPageLimit, cutKeysetPage } from '../internal/keyset-cursor.ts'
import { keysetResume } from '../internal/keyset-query.ts'
import { orUnavailable } from '../internal/unavailable.ts'
import { auditedMutations } from '../governance/audited-mutation.ts'
import { AuditEventLog } from '../governance/audit-event-log.ts'
import { publishWebhookEventWith, WebhookPublisher } from './webhook-publisher.ts'
import { WorkspaceContext } from '../workspace-context.ts'
import {
  ApiTokenRegistry,
  hashApiToken,
  shouldBumpLastUsedAt,
  type ApiToken
} from './api-token-registry.ts'

function randomToken(): string {
  return `bsk_live_${randomHex(24)}`
}

function tokenPrefix(token: string): string {
  return token.slice(0, 17)
}

const unavailable = orUnavailable('api-token-registry')

/**
 * The scoped WHERE clause for an active (unrevoked) token of a workspace:
 * revoke's pre-check and write share it, and list drops the id condition by
 * omitting `tokenId`.
 */
function activeTokenWhere(tokenId: string | undefined, workspaceId: string) {
  const conditions = [
    eq(apiTokens.workspaceId, workspaceId),
    isNull(apiTokens.revokedAt)
  ]
  if (tokenId !== undefined) {
    conditions.push(eq(apiTokens.id, tokenId))
  }
  return and(...conditions)
}

/** The wire projection of a stored token row — assembled once, reused by the list, the fan-out payload, and the create return. */
function toTokenProjection(row: typeof apiTokens.$inferSelect): ApiToken {
  return {
    id: row.id,
    name: row.name,
    prefix: row.tokenPrefix,
    scopes: row.scopes,
    lastUsedAt: row.lastUsedAt,
    createdAt: row.createdAt
  }
}

export const LiveApiTokenRegistry: Layer.Layer<
  ApiTokenRegistry,
  never,
  Database | RawD1 | AuditEventLog | WebhookPublisher
> = Layer.effect(ApiTokenRegistry)(
  Effect.gen(function* () {
    const db = yield* Database
    const audit = yield* AuditEventLog
    const publisher = yield* WebhookPublisher

    // The shared mutate+audit combinator — one implementation of the batched
    // write, its zero-match skip, and the phantom-audit caveat (see
    // governance/audited-mutation.ts).
    const auditedMutation = yield* auditedMutations({
      prepareAuditRecord: audit.prepareRecord,
      unavailable
    })

    return {
      list: Effect.gen(function* () {
        const ctx = yield* WorkspaceContext
        const rows = yield* unavailable(
          db
            .select()
            .from(apiTokens)
            .where(activeTokenWhere(undefined, ctx.workspace.id))
            .orderBy(desc(apiTokens.createdAt))
        )
        return rows.map(toTokenProjection)
      }),
      listPage: (input) =>
        Effect.gen(function* () {
          const ctx = yield* WorkspaceContext
          const limit = clampPageLimit(input?.limit)
          const conditions: Array<SQL | undefined> = [
            activeTokenWhere(undefined, ctx.workspace.id)
          ]
          // The SQL half of the keyset recipe lives in `keyset-query.ts`,
          // shared with every other paged Live read.
          const resume = keysetResume(
            'desc',
            { key: apiTokens.createdAt, id: apiTokens.id },
            input?.cursor
          )
          if (resume.kind === 'empty') {
            return { items: [], nextCursor: null }
          }
          if (resume.kind === 'resume') {
            conditions.push(resume.condition)
          }
          // One row past the page cap, so `cutKeysetPage` can see whether
          // the cap actually cut rows off before offering a cursor.
          const rows = yield* unavailable(
            db
              .select()
              .from(apiTokens)
              .where(and(...conditions))
              .orderBy(desc(apiTokens.createdAt), desc(apiTokens.id))
              .limit(limit + 1)
          )
          return cutKeysetPage(rows.map(toTokenProjection), limit, (token) => ({
            key: token.createdAt,
            id: token.id
          }))
        }),
      create: (input) =>
        Effect.gen(function* () {
          const ctx = yield* WorkspaceContext
          // Entitlement gate: the workspace's plan caps token count. The
          // rule and the counting both live in the billing capability, so no
          // caller can forget the gate.
          yield* assertWithinPlanLimitFor({
            resource: 'api_token',
            db,
            capability: 'api-token-registry',
            table: apiTokens,
            where: and(
              eq(apiTokens.workspaceId, ctx.workspace.id),
              isNull(apiTokens.revokedAt)
            )
          })
          const token = randomToken()
          const createdAt = DateTime.formatIso(yield* DateTime.now)
          const row = {
            id: yield* newCapabilityId('tok'),
            workspaceId: ctx.workspace.id,
            name: input.name,
            tokenPrefix: tokenPrefix(token),
            tokenHash: yield* Effect.promise(() => hashApiToken(token)),
            scopes: [...input.scopes],
            lastUsedAt: null,
            revokedAt: null,
            createdAt,
            createdByUserId: ctx.actor?.userId ?? null
          }
          // Insert + audit insert as one batch — the shared audited-mutation
          // shape with an unconditional match.
          yield* auditedMutation({
            matched: Effect.succeed(true),
            auditEvent: {
              workspaceId: ctx.workspace.id,
              actorUserId: ctx.actor?.userId ?? null,
              eventType: 'api_token.created',
              targetType: 'api_token',
              targetId: row.id,
              metadata: { name: input.name, scopes: input.scopes }
            },
            write: () => db.insert(apiTokens).values(row)
          })
          // Fan-out sits beside the audit write, below the interface: the
          // projection only — never the minted secret.
          yield* publishWebhookEventWith(publisher, {
            eventType: 'api_token.created',
            payload: toTokenProjection(row)
          })
          return { ...toTokenProjection(row), token }
        }),
      revoke: (input) =>
        Effect.gen(function* () {
          const ctx = yield* WorkspaceContext
          const revokedAt = yield* DateTime.now
          // Update + audit insert as one batch; a token that is absent,
          // foreign, or already revoked matches nothing and skips both — no
          // phantom revocation.
          const applied = yield* auditedMutation({
            matched: unavailable(
              db
                .select({ id: apiTokens.id })
                .from(apiTokens)
                .where(activeTokenWhere(input.tokenId, ctx.workspace.id))
                .limit(1)
            ).pipe(Effect.map((rows) => rows.length > 0)),
            auditEvent: {
              workspaceId: ctx.workspace.id,
              actorUserId: ctx.actor?.userId ?? null,
              eventType: 'api_token.revoked',
              targetType: 'api_token',
              targetId: input.tokenId,
              metadata: {}
            },
            write: () =>
              db
                .update(apiTokens)
                .set({ revokedAt: DateTime.formatIso(revokedAt) })
                .where(activeTokenWhere(input.tokenId, ctx.workspace.id))
          })
          if (!applied) {
            return false
          }
          yield* publishWebhookEventWith(publisher, {
            eventType: 'api_token.revoked',
            payload: { tokenId: input.tokenId }
          })
          return true
        }),
      verifyBearerToken: (token) =>
        Effect.gen(function* () {
          const tokenHash = yield* Effect.promise(() => hashApiToken(token))
          const row = yield* unavailable(
            db
              .select({ token: apiTokens, workspace: workspaces })
              .from(apiTokens)
              .innerJoin(workspaces, eq(apiTokens.workspaceId, workspaces.id))
              .where(
                and(eq(apiTokens.tokenHash, tokenHash), isNull(apiTokens.revokedAt))
              )
              .limit(1)
          ).pipe(Effect.map((rows) => rows[0]))
          // An unknown or revoked token is the only failure here, and the API
          // worker answers it 401. A known token that may not do what it asked
          // is a separate 403 raised by `requirePermission` at the boundary.
          if (!row) {
            return yield* Effect.fail(
              new AuthorizationDenied({ reason: 'invalid_token' })
            )
          }
          // Bump `lastUsedAt` at most once per LAST_USED_WRITE_INTERVAL_MS.
          // The per-request `api_token.used` audit event was removed: it did a
          // second D1 write per request and flooded the governance log. The
          // bump is best-effort telemetry — a transient write failure has no
          // bearing on whether the token authenticates, so it is swallowed
          // rather than failing an otherwise-valid request with 503.
          const usedAt = yield* DateTime.now
          if (
            shouldBumpLastUsedAt(row.token.lastUsedAt, DateTime.toEpochMillis(usedAt))
          ) {
            yield* unavailable(
              db
                .update(apiTokens)
                .set({ lastUsedAt: DateTime.formatIso(usedAt) })
                .where(eq(apiTokens.id, row.token.id))
            ).pipe(Effect.ignore)
          }
          return {
            id: row.token.id,
            workspaceId: row.workspace.id,
            workspaceSlug: row.workspace.slug,
            scopes: row.token.scopes
          }
        })
    }
  })
)
