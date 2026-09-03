import {
  oauthAccessToken,
  oauthClient,
  oauthConsent,
  oauthRefreshToken,
  workspaces
} from '@b2b-saas-starter/db/schema'
import { batch, Database, RawD1 } from '@b2b-saas-starter/db/service'
import { DateTime, Effect, Layer } from 'effect'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { type AnySQLiteColumn } from 'drizzle-orm/sqlite-core'

import { AuditEventLog } from '../governance/audit-event-log.ts'
import { orUnavailable } from '../internal/unavailable.ts'
import {
  McpClientConnections,
  type McpClientConnection,
  type McpClientSummary
} from './mcp-client-connections.ts'

const unavailable = orUnavailable('mcp-client-connections')

function toClientSummary(
  row: typeof oauthClient.$inferSelect | null
): McpClientSummary {
  return {
    clientId: row?.clientId ?? 'unknown',
    name: row?.name ?? null,
    uri: row?.uri ?? null
  }
}

/**
 * The tokens a consent minted: same client, same user, same workspace
 * reference. Revoking marks them rather than deleting, which is what the
 * provider's own revocation endpoint does and what its token lookups filter on.
 */
function consentTokenWhere(
  table: {
    readonly clientId: AnySQLiteColumn
    readonly userId: AnySQLiteColumn
    readonly referenceId: AnySQLiteColumn
    readonly revoked: AnySQLiteColumn
  },
  consent: typeof oauthConsent.$inferSelect
) {
  const conditions = [eq(table.clientId, consent.clientId), isNull(table.revoked)]
  if (consent.referenceId === null) {
    conditions.push(isNull(table.referenceId))
  } else {
    conditions.push(eq(table.referenceId, consent.referenceId))
  }
  if (consent.userId !== null) {
    conditions.push(eq(table.userId, consent.userId))
  }
  return and(...conditions)
}

export const LiveMcpClientConnections: Layer.Layer<
  McpClientConnections,
  never,
  Database | RawD1 | AuditEventLog
> = Layer.effect(McpClientConnections)(
  Effect.gen(function* () {
    const db = yield* Database
    const d1 = yield* RawD1
    const audit = yield* AuditEventLog

    return {
      describeClient: (clientId) =>
        unavailable(
          db
            .select()
            .from(oauthClient)
            .where(eq(oauthClient.clientId, clientId))
            .limit(1)
        ).pipe(
          Effect.map((rows) => {
            const row = rows[0]
            if (row === undefined) {
              return null
            }
            return toClientSummary(row)
          })
        ),
      listForUser: (userId) =>
        unavailable(
          db
            .select({
              consent: oauthConsent,
              client: oauthClient,
              workspace: workspaces
            })
            .from(oauthConsent)
            .leftJoin(oauthClient, eq(oauthConsent.clientId, oauthClient.clientId))
            .leftJoin(workspaces, eq(oauthConsent.referenceId, workspaces.id))
            .where(eq(oauthConsent.userId, userId))
            .orderBy(desc(oauthConsent.createdAt))
        ).pipe(
          Effect.map((rows) =>
            rows.map((row): McpClientConnection => {
              let workspace: McpClientConnection['workspace'] = null
              if (row.workspace !== null) {
                workspace = {
                  id: row.workspace.id,
                  slug: row.workspace.slug,
                  name: row.workspace.name
                }
              }
              return {
                id: row.consent.id,
                client: toClientSummary(row.client),
                workspace,
                scopes: row.consent.scopes,
                grantedAt: row.consent.createdAt.toISOString()
              }
            })
          )
        ),
      recordGrant: (input) =>
        audit.record({
          workspaceId: input.workspaceId,
          actorUserId: input.userId,
          eventType: 'mcp_client.consent_granted',
          targetType: 'mcp_client',
          targetId: input.clientId,
          metadata: { scopes: [...input.scopes] }
        }),
      revoke: (input) =>
        Effect.gen(function* () {
          // Ownership is part of the lookup, so another user's consent id
          // matches nothing — and nothing is written.
          const consent = yield* unavailable(
            db
              .select()
              .from(oauthConsent)
              .where(
                and(
                  eq(oauthConsent.id, input.connectionId),
                  eq(oauthConsent.userId, input.userId)
                )
              )
              .limit(1)
          ).pipe(Effect.map((rows) => rows[0]))
          if (consent === undefined) {
            return false
          }
          const revokedAt = DateTime.toDate(yield* DateTime.now)
          const auditStatement = yield* audit.prepareRecord({
            workspaceId: consent.referenceId,
            actorUserId: input.userId,
            eventType: 'mcp_client.consent_revoked',
            targetType: 'mcp_client',
            targetId: consent.clientId,
            metadata: { scopes: [...consent.scopes] }
          })
          // Consent delete, token revocations and the audit row commit
          // together: a client must not keep a working refresh token after
          // the user revoked it, and the trail must say the revocation
          // happened.
          yield* unavailable(
            batch([
              db.delete(oauthConsent).where(eq(oauthConsent.id, consent.id)),
              db
                .update(oauthRefreshToken)
                .set({ revoked: revokedAt })
                .where(consentTokenWhere(oauthRefreshToken, consent)),
              db
                .update(oauthAccessToken)
                .set({ revoked: revokedAt })
                .where(consentTokenWhere(oauthAccessToken, consent)),
              auditStatement
            ])
          ).pipe(Effect.provideService(RawD1, d1))
          return true
        })
    }
  })
)
