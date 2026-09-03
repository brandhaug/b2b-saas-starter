import {
  oauthAccessToken,
  oauthClient,
  oauthConsent,
  oauthRefreshToken
} from '@b2b-saas-starter/db/schema'
import { Database } from '@b2b-saas-starter/db/service'
import { Effect } from 'effect'
import { eq } from 'drizzle-orm'
import { describe, expect, layer } from '@effect/vitest'

import { AuditEventLog } from '../governance/audit-event-log.ts'
import { mcpClientConnectionsContractCases } from './mcp-client-connections.contract.ts'
import {
  inWorkspace,
  LIVE_SUITE_TIMEOUT,
  TestDatabase
} from '../testing/live-harness.ts'
import { McpClientConnections } from './mcp-client-connections.ts'

// oxlint-disable-next-line effect/noGlobals -- fixture literal, not runtime time
const grantedAt = new Date('2026-08-20T10:00:00.000Z')
// oxlint-disable-next-line effect/noGlobals -- fixture literal, not runtime time
const farFuture = new Date('2027-01-01T00:00:00.000Z')

const CLIENT_ID = 'https://mcp-client.live.test/oauth/client-metadata.json'

/** The rows the OAuth provider would have written during an authorization. */
const insertConsentRows = Effect.gen(function* () {
  const db = yield* Database
  yield* db.insert(oauthClient).values({
    id: 'oac_live',
    clientId: CLIENT_ID,
    name: 'Live MCP client',
    uri: 'https://mcp-client.live.test',
    redirectUris: ['http://127.0.0.1:33418/callback']
  })
  yield* db.insert(oauthConsent).values([
    {
      id: 'con_live_owner',
      clientId: CLIENT_ID,
      userId: 'usr_owner',
      referenceId: 'wrk_live',
      scopes: ['mcp:read', 'offline_access'],
      createdAt: grantedAt,
      updatedAt: grantedAt
    },
    // Another user's consent to the same client: revoke must never reach it.
    {
      id: 'con_live_outsider',
      clientId: CLIENT_ID,
      userId: 'usr_outsider',
      referenceId: 'wrk_other',
      scopes: ['mcp:read'],
      createdAt: grantedAt,
      updatedAt: grantedAt
    }
  ])
  yield* db.insert(oauthRefreshToken).values([
    {
      id: 'ort_live_owner',
      token: 'rt_owner',
      clientId: CLIENT_ID,
      userId: 'usr_owner',
      referenceId: 'wrk_live',
      scopes: ['mcp:read', 'offline_access'],
      expiresAt: farFuture
    },
    {
      id: 'ort_live_outsider',
      token: 'rt_outsider',
      clientId: CLIENT_ID,
      userId: 'usr_outsider',
      referenceId: 'wrk_other',
      scopes: ['mcp:read'],
      expiresAt: farFuture
    }
  ])
  yield* db.insert(oauthAccessToken).values({
    id: 'oat_live_owner',
    token: 'at_owner',
    clientId: CLIENT_ID,
    userId: 'usr_owner',
    referenceId: 'wrk_live',
    refreshId: 'ort_live_owner',
    scopes: ['mcp:read', 'offline_access'],
    expiresAt: farFuture
  })
})

layer(TestDatabase, { timeout: LIVE_SUITE_TIMEOUT })(
  'live mcp client connections',
  (it) => {
    describe('list, describe, revoke', () => {
      it.effect(
        "lists a user's consents with the client and workspace resolved, and revokes one with its tokens",
        () =>
          Effect.gen(function* () {
            yield* insertConsentRows

            const described = yield* inWorkspace(
              'live-lab',
              Effect.flatMap(McpClientConnections, (connections) =>
                connections.describeClient(CLIENT_ID)
              )
            )
            expect(described).toEqual({
              clientId: CLIENT_ID,
              name: 'Live MCP client',
              uri: 'https://mcp-client.live.test'
            })

            const listed = yield* inWorkspace(
              'live-lab',
              Effect.flatMap(McpClientConnections, (connections) =>
                connections.listForUser('usr_owner')
              )
            )
            expect(listed).toEqual([
              {
                id: 'con_live_owner',
                client: {
                  clientId: CLIENT_ID,
                  name: 'Live MCP client',
                  uri: 'https://mcp-client.live.test'
                },
                workspace: { id: 'wrk_live', slug: 'live-lab', name: 'Live Lab' },
                scopes: ['mcp:read', 'offline_access'],
                grantedAt: grantedAt.toISOString()
              }
            ])

            // Another user's id for this consent matches nothing.
            const foreign = yield* inWorkspace(
              'live-lab',
              Effect.flatMap(McpClientConnections, (connections) =>
                connections.revoke({
                  userId: 'usr_outsider',
                  connectionId: 'con_live_owner'
                })
              )
            )
            expect(foreign).toBe(false)

            const revoked = yield* inWorkspace(
              'live-lab',
              Effect.flatMap(McpClientConnections, (connections) =>
                connections.revoke({
                  userId: 'usr_owner',
                  connectionId: 'con_live_owner'
                })
              )
            )
            expect(revoked).toBe(true)

            const db = yield* Database
            const consents = yield* db.select().from(oauthConsent)
            expect(consents.map((row) => row.id)).toEqual(['con_live_outsider'])
            const refreshTokens = yield* db.select().from(oauthRefreshToken)
            expect(
              refreshTokens.find((row) => row.id === 'ort_live_owner')?.revoked
            ).not.toBeNull()
            // The other user's token is untouched.
            expect(
              refreshTokens.find((row) => row.id === 'ort_live_outsider')?.revoked
            ).toBeNull()
            const accessTokens = yield* db
              .select()
              .from(oauthAccessToken)
              .where(eq(oauthAccessToken.id, 'oat_live_owner'))
            expect(accessTokens[0]?.revoked).not.toBeNull()

            const events = yield* inWorkspace(
              'live-lab',
              Effect.flatMap(AuditEventLog, (log) => log.list())
            )
            const revokedEvent = events.events.find(
              (event) => event.eventType === 'mcp_client.consent_revoked'
            )
            expect(revokedEvent?.targetType).toBe('mcp_client')
            expect(revokedEvent?.targetId).toBe(CLIENT_ID)
            expect(revokedEvent?.actor).toBe('Owner One')

            // Revoking again finds nothing: no phantom audit row.
            const again = yield* inWorkspace(
              'live-lab',
              Effect.flatMap(McpClientConnections, (connections) =>
                connections.revoke({
                  userId: 'usr_owner',
                  connectionId: 'con_live_owner'
                })
              )
            )
            expect(again).toBe(false)
          })
      )

      it.effect('records the grant as an audit event in the consented workspace', () =>
        Effect.gen(function* () {
          yield* inWorkspace(
            'live-lab',
            Effect.flatMap(McpClientConnections, (connections) =>
              connections.recordGrant({
                userId: 'usr_owner',
                workspaceId: 'wrk_live',
                clientId: CLIENT_ID,
                scopes: ['mcp:read']
              })
            )
          )
          const events = yield* inWorkspace(
            'live-lab',
            Effect.flatMap(AuditEventLog, (log) => log.list())
          )
          const granted = events.events.find(
            (event) => event.eventType === 'mcp_client.consent_granted'
          )
          expect(granted?.targetId).toBe(CLIENT_ID)
          expect(granted?.actor).toBe('Owner One')
        })
      )

      // The contract cases that both adapters must satisfy from an empty
      // store — the revoke-with-tokens flow above stays in this file, since
      // its rows are the provider's writes.
      for (const contractCase of mcpClientConnectionsContractCases(expect)) {
        it.effect(contractCase.name, () => inWorkspace('live-lab', contractCase.assert))
      }

      it.effect('revokes the tokens of a consent that named no workspace', () =>
        Effect.gen(function* () {
          const db = yield* Database
          yield* db.insert(oauthConsent).values({
            id: 'con_live_anonymous',
            clientId: CLIENT_ID,
            userId: 'usr_owner',
            referenceId: null,
            scopes: ['mcp:read'],
            createdAt: grantedAt,
            updatedAt: grantedAt
          })
          yield* db.insert(oauthRefreshToken).values({
            id: 'ort_live_anonymous',
            token: 'rt_anonymous',
            clientId: CLIENT_ID,
            userId: 'usr_owner',
            referenceId: null,
            scopes: ['mcp:read'],
            expiresAt: farFuture
          })

          const revoked = yield* inWorkspace(
            'live-lab',
            Effect.flatMap(McpClientConnections, (connections) =>
              connections.revoke({
                userId: 'usr_owner',
                connectionId: 'con_live_anonymous'
              })
            )
          )
          expect(revoked).toBe(true)

          const refreshTokens = yield* db.select().from(oauthRefreshToken)
          expect(
            refreshTokens.find((row) => row.id === 'ort_live_anonymous')?.revoked
          ).not.toBeNull()
        })
      )
    })
  }
)
