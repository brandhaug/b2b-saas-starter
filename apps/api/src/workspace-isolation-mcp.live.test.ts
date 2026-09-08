import { McpClientConnections } from '@b2b-saas-starter/capabilities/developer-platform/mcp-client-connections'
import { RateLimiter } from '@b2b-saas-starter/api'
import {
  LIVE_SUITE_TIMEOUT,
  TestDatabase,
  TestD1
} from '@b2b-saas-starter/capabilities/testing/live-harness'
import { selectCapabilitiesLayer } from '@b2b-saas-starter/capabilities/runtime'
import { expect, layer } from '@effect/vitest'
import { Effect, Layer, Schema } from 'effect'
import { HttpRouter } from 'effect/unstable/http'
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose'
import { mcpProtocolLayer } from './mcp.ts'
import { makeOAuthTokenVerifier, OAuthTokenVerifier } from './oauth-access-token.ts'
import { jsonBody, mcpClient } from './test-utils.ts'

const decodeRecord = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Struct({ id: Schema.String }))
)
const rpcError = Schema.Struct({
  error: Schema.Struct({ code: Schema.Number, message: Schema.String }),
  result: Schema.optional(Schema.Json)
})
const resourceResult = Schema.Struct({
  result: Schema.Struct({
    contents: Schema.Array(Schema.Struct({ text: Schema.String }))
  })
})
const envelope = Schema.Struct({
  result: Schema.Struct({
    isError: Schema.optional(Schema.Boolean),
    content: Schema.Array(Schema.Struct({ text: Schema.String })),
    structuredContent: Schema.optional(Schema.Json)
  })
})
function call(
  client: ReturnType<typeof mcpClient>,
  name: string,
  args: Schema.Json = {}
) {
  return Effect.promise(() => client.rpc('tools/call', { name, arguments: args })).pipe(
    Effect.flatMap((response) => jsonBody(response, envelope)),
    Effect.map((body) => body.result)
  )
}
function resource(client: ReturnType<typeof mcpClient>) {
  return Effect.promise(() =>
    client.rpc('resources/read', { uri: 'workspace://overview' })
  )
}
function expectResourceDenied(client: ReturnType<typeof mcpClient>) {
  return resource(client).pipe(
    Effect.flatMap((response) => jsonBody(response, rpcError)),
    Effect.map((body) => {
      expect(body.error.code).toBe(-32_603)
      expect(body.error.message).toContain('denied:')
      expect(body.error.message).not.toContain('private.example')
      expect(body.result).toBeUndefined()
      return body
    })
  )
}
function execute(sql: string, ...values: ReadonlyArray<string>) {
  return Effect.flatMap(TestD1, (db) =>
    Effect.promise(() =>
      db
        .prepare(sql)
        .bind(...values)
        .run()
    )
  )
}

layer(TestDatabase, { timeout: LIVE_SUITE_TIMEOUT })(
  'MCP OAuth Workspace isolation',
  (it) => {
    it.effect(
      'one user in two Workspaces cannot reuse consent or stale Workspace authority',
      () =>
        Effect.gen(function* () {
          const DB = yield* TestD1
          for (const userId of ['usr_joiner', 'usr_outsider', 'usr_owner']) {
            yield* execute(
              `INSERT INTO passkey (id,userId,publicKey,credentialID,counter,deviceType,backedUp,createdAt)
              VALUES (?,?,'fixture-public-key',?,0,'singleDevice',0,strftime('%s','now'))`,
              `pk_isolation_${userId}`,
              userId,
              `credential_isolation_${userId}`
            )
            yield* execute(
              `INSERT INTO session (id,token,userId,expiresAt,createdAt,updatedAt,strongAuthAt,strongAuthMethod,strongAuthCredentialId)
              VALUES (?,?,?,strftime('%s','now')+3600,strftime('%s','now'),strftime('%s','now'),strftime('%s','now'),'passkey',?)`,
              `ses_${userId}`,
              `tok_${userId}`,
              userId,
              `pk_isolation_${userId}`
            )
          }
          yield* execute(`INSERT INTO workspace_members (id,workspaceId,userId,role) VALUES
      ('mem_isolation_multi_a','wrk_dev_contract','usr_joiner','owner'),
      ('mem_isolation_multi_b','wrk_other','usr_joiner','owner'),
      ('mem_isolation_other','wrk_other','usr_outsider','owner')`)
          yield* execute(
            `INSERT INTO oauth_client (id,clientId,redirectUris,disabled) VALUES ('client-isolation','isolation-client','[]',0)`
          )
          yield* execute(`INSERT INTO oauth_consent (id,userId,clientId,referenceId,scopes) VALUES
      ('consent-isolation-a','usr_joiner','isolation-client','wrk_dev_contract','["mcp:read","mcp:write"]'),
      ('consent-isolation-b','usr_joiner','isolation-client','wrk_other','["mcp:read","mcp:write"]'),
      ('consent-isolation-other','usr_outsider','isolation-client','wrk_other','["mcp:read","mcp:write"]'),
      ('consent-isolation-owner','usr_owner','isolation-client','wrk_dev_contract','["mcp:read"]')`)
          const issuer = 'https://issuer.test/api/auth'
          const audience = 'https://api.test/mcp'
          const keys = yield* Effect.promise(() => generateKeyPair('EdDSA'))
          const jwk = yield* Effect.promise(() => exportJWK(keys.publicKey))
          const { handler } = HttpRouter.toWebHandler(
            mcpProtocolLayer({ DB }).pipe(
              Layer.provide(
                Layer.mergeAll(
                  selectCapabilitiesLayer({ DB }),
                  Layer.succeed(OAuthTokenVerifier)(
                    makeOAuthTokenVerifier(
                      { issuer, audience },
                      createLocalJWKSet({ keys: [jwk] })
                    )
                  ),
                  Layer.succeed(RateLimiter)({ take: () => Effect.succeed(true) })
                )
              )
            ),
            { disableLogger: true }
          )
          function clientFor(
            userId: string,
            workspaceId: string,
            workspaceSlug: string,
            consent: string,
            scopes = 'mcp:read mcp:write'
          ) {
            return Effect.promise(() =>
              new SignJWT({
                sub: userId,
                client_id: 'isolation-client',
                scope: scopes,
                starter_workspace_id: workspaceId,
                starter_workspace_slug: workspaceSlug,
                starter_workspace_role: 'owner',
                starter_consent_binding: `${consent}:0`,
                starter_session_id: `ses_${userId}`
              })
                .setProtectedHeader({ alg: 'EdDSA' })
                .setIssuer(issuer)
                .setAudience(audience)
                .setIssuedAt()
                .setExpirationTime('1h')
                .sign(keys.privateKey)
            ).pipe(Effect.map((jwt) => mcpClient(handler, `Bearer ${jwt}`)))
          }
          const a = yield* clientFor(
            'usr_joiner',
            'wrk_dev_contract',
            'dev-contract-lab',
            'consent-isolation-a'
          )
          const b = yield* clientFor(
            'usr_joiner',
            'wrk_other',
            'other-lab',
            'consent-isolation-b'
          )
          const other = yield* clientFor(
            'usr_outsider',
            'wrk_other',
            'other-lab',
            'consent-isolation-other'
          )
          const owner = yield* clientFor(
            'usr_owner',
            'wrk_dev_contract',
            'dev-contract-lab',
            'consent-isolation-owner',
            'mcp:read'
          )
          for (const client of [a, b, other, owner]) {
            yield* Effect.promise(() => client.initialize())
          }
          for (const client of [a, b, other, owner]) {
            expect((yield* call(client, 'get_workspace_overview')).isError).not.toBe(
              true
            )
          }
          const overviewResource = yield* resource(owner).pipe(
            Effect.flatMap((response) => jsonBody(response, resourceResult))
          )
          expect(overviewResource.result.contents[0]?.text).toContain(
            'dev-contract-lab'
          )
          expect(
            (yield* call(owner, 'create_webhook', {
              url: 'https://blocked.example',
              events: ['api_token.created']
            })).isError
          ).toBe(true)
          const created = yield* call(other, 'create_webhook', {
            url: 'https://private.example/mcp',
            events: ['api_token.created']
          })
          expect(created.isError).not.toBe(true)
          const endpoint = yield* decodeRecord(created.content[0]?.text)
          const before = yield* call(b, 'list_webhooks')
          const auditBefore = yield* call(b, 'list_audit_events')
          const rejected = yield* call(a, 'update_webhook', {
            endpointId: endpoint.id,
            enabled: false,
            workspaceSlug: 'other-lab'
          })
          expect(rejected.isError).toBe(true)
          expect(rejected.content[0]?.text).toBe('webhook endpoint not found')
          expect(
            (yield* call(a, 'list_webhook_deliveries', { endpointId: endpoint.id }))
              .content[0]?.text
          ).toBe('[]')
          // Even a signed token naming B must not borrow a grant issued for A.
          const reused = yield* clientFor(
            'usr_joiner',
            'wrk_other',
            'other-lab',
            'consent-isolation-a'
          )
          yield* Effect.promise(() => reused.initialize())
          expect(
            (yield* call(reused, 'delete_webhook', { endpointId: endpoint.id })).isError
          ).toBe(true)
          expect((yield* call(reused, 'get_workspace_overview')).isError).toBe(true)
          yield* expectResourceDenied(reused)
          expect(yield* call(b, 'list_webhooks')).toEqual(before)
          expect(yield* call(b, 'list_audit_events')).toEqual(auditBefore)
          // Current membership wins over the owner role stamped in this same JWT.
          yield* execute(
            `UPDATE workspace_members SET role='member' WHERE id='mem_isolation_multi_b'`
          )
          expect((yield* call(b, 'list_webhooks')).isError).toBe(true)
          expect(
            (yield* call(b, 'delete_webhook', { endpointId: endpoint.id })).isError
          ).toBe(true)
          expect((yield* call(b, 'get_workspace_overview')).isError).not.toBe(true)
          expect((yield* call(b, 'list_notifications')).isError).not.toBe(true)
          yield* execute(
            `DELETE FROM workspace_members WHERE id='mem_isolation_multi_b'`
          )
          const removed = yield* call(b, 'get_workspace_overview')
          expect(removed.isError).toBe(true)
          expect(removed.content[0]?.text).toBe('workspace not found')
          expect(removed.structuredContent).toBeUndefined()
          expect((yield* call(a, 'get_workspace_overview')).isError).not.toBe(true)
          expect(yield* call(other, 'list_webhooks')).toEqual(before)
          const revoked = yield* Effect.flatMap(McpClientConnections, (connections) =>
            connections.revoke({
              userId: 'usr_joiner',
              connectionId: 'consent-isolation-a'
            })
          ).pipe(Effect.provide(selectCapabilitiesLayer({ DB })))
          expect(revoked).toBe(true)
          const revokedRead = yield* call(a, 'get_workspace_overview')
          expect(revokedRead.isError).toBe(true)
          yield* expectResourceDenied(a)
          yield* execute(
            `INSERT INTO oauth_consent (id,userId,clientId,referenceId,scopes) VALUES ('consent-isolation-a-new','usr_joiner','isolation-client','wrk_dev_contract','["mcp:read","mcp:write"]')`
          )
          const restored = yield* clientFor(
            'usr_joiner',
            'wrk_dev_contract',
            'dev-contract-lab',
            'consent-isolation-a-new'
          )
          yield* Effect.promise(() => restored.initialize())
          expect((yield* call(restored, 'list_webhooks')).isError).not.toBe(true)
          // Reassigning a slug must not retarget an already issued token to B.
          yield* execute(
            `INSERT INTO workspace_members (id,workspaceId,userId,role) VALUES ('mem_isolation_multi_b','wrk_other','usr_joiner','owner')`
          )
          yield* execute(
            `UPDATE workspaces SET slug='renamed-a' WHERE id='wrk_dev_contract'`
          )
          yield* execute(
            `UPDATE workspaces SET slug='dev-contract-lab' WHERE id='wrk_other'`
          )
          for (const status of ['active', 'suspended']) {
            yield* execute(
              'UPDATE workspaces SET suspensionStatus=? WHERE id=?',
              status,
              'wrk_other'
            )
            const retargeted = yield* call(restored, 'list_webhooks')
            expect(retargeted.isError).toBe(true)
            expect(retargeted.content[0]?.text).not.toContain('private.example')
            expect(retargeted.structuredContent).toBeUndefined()
            yield* expectResourceDenied(restored)
          }
          yield* execute(
            `UPDATE workspaces SET suspensionStatus='active' WHERE id='wrk_other'`
          )
          const rebound = yield* clientFor(
            'usr_joiner',
            'wrk_other',
            'dev-contract-lab',
            'consent-isolation-b'
          )
          yield* Effect.promise(() => rebound.initialize())
          expect(yield* call(rebound, 'list_webhooks')).toEqual(before)
        }),
      120_000
    )
  }
)
