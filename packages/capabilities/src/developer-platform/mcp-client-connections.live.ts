import {
  oauthAccessToken,
  oauthClient,
  oauthConsent,
  oauthRefreshToken,
  workspaces
} from '@b2b-saas-starter/db/schema'
import { Database, type RawD1 } from '@b2b-saas-starter/db/service'
import { DateTime, Effect, Layer } from 'effect'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { type AnySQLiteColumn } from 'drizzle-orm/sqlite-core'

import { AuditEventLog } from '../governance/audit-event-log.ts'
import { auditedMutations } from '../governance/audited-mutation.ts'
import { orUnavailable } from '../internal/unavailable.ts'
import {
  consentGrantedAuditEvent,
  consentRevokedAuditEvent,
  McpClientConnections,
  type McpClientConnection,
  type McpClientSummary
} from './mcp-client-connections.ts'

const unavailable = orUnavailable('mcp-client-connections')

/** The client half of a connection. `clientId` comes from the consent row — NOT NULL there — so it never needs a fallback; only the joined client's display fields can be missing. */
function toClientSummary(
  clientId: string,
  row: typeof oauthClient.$inferSelect | null
): McpClientSummary {
  return {
    clientId,
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
  consent: {
    readonly clientId: string
    readonly userId: string
    readonly referenceId: string | null
  }
) {
  const conditions = [
    eq(table.clientId, consent.clientId),
    eq(table.userId, consent.userId),
    isNull(table.revoked)
  ]
  if (consent.referenceId === null) {
    conditions.push(isNull(table.referenceId))
  } else {
    conditions.push(eq(table.referenceId, consent.referenceId))
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
    const audit = yield* AuditEventLog
    // The shared mutate+audit combinator (governance/audited-mutation.ts):
    // one D1 batch, its zero-match skip, and the phantom-audit caveat.
    const auditedMutation = yield* auditedMutations({
      prepareAuditRecord: audit.prepareRecord,
      unavailable
    })

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
            return toClientSummary(row.clientId, row)
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
                client: toClientSummary(row.consent.clientId, row.client),
                workspace,
                scopes: row.consent.scopes,
                grantedAt: row.consent.createdAt.toISOString()
              }
            })
          )
        ),
      recordGrant: (input) => audit.record(consentGrantedAuditEvent(input)),
      revoke: (input) =>
        Effect.gen(function* () {
          // Ownership is part of the lookup, so another user's consent id
          // matches nothing — and nothing is written. The workspace join
          // resolves the consent's workspace in the same read: a consent can
          // outlive its workspace (referenceId is deliberately FK-free), and
          // the audit row must then carry no workspace — a dangling id would
          // violate audit_events' FK and roll the whole revoke back.
          const rows = yield* unavailable(
            db
              .select({ consent: oauthConsent, workspaceId: workspaces.id })
              .from(oauthConsent)
              .leftJoin(workspaces, eq(oauthConsent.referenceId, workspaces.id))
              .where(
                and(
                  eq(oauthConsent.id, input.connectionId),
                  eq(oauthConsent.userId, input.userId)
                )
              )
              .limit(1)
          )
          const row = rows[0]
          if (row === undefined) {
            return false
          }
          const { consent, workspaceId } = row
          const revokedAt = DateTime.toDate(yield* DateTime.now)
          // The pre-check matched on this exact user, so the token revocations
          // key off `input.userId` rather than the (typed-nullable) column.
          const tokenScope = {
            clientId: consent.clientId,
            userId: input.userId,
            referenceId: consent.referenceId
          }
          // Consent delete, token revocations and the audit row commit
          // together: a client must not keep a working refresh token after
          // the user revoked it, and the trail must say the revocation
          // happened.
          return yield* auditedMutation({
            matched: Effect.succeed(true),
            auditEvent: consentRevokedAuditEvent({
              userId: input.userId,
              clientId: consent.clientId,
              scopes: consent.scopes,
              workspaceId
            }),
            write: () => [
              db.delete(oauthConsent).where(eq(oauthConsent.id, consent.id)),
              db
                .update(oauthRefreshToken)
                .set({ revoked: revokedAt })
                .where(consentTokenWhere(oauthRefreshToken, tokenScope)),
              db
                .update(oauthAccessToken)
                .set({ revoked: revokedAt })
                .where(consentTokenWhere(oauthAccessToken, tokenScope))
            ]
          })
        })
    }
  })
)
