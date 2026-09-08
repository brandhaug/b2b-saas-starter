import {
  SEED_API_TOKEN,
  hashApiToken
} from '@b2b-saas-starter/capabilities/developer-platform/api-token-registry'
import {
  LIVE_SUITE_TIMEOUT,
  TestDatabase,
  TestD1
} from '@b2b-saas-starter/capabilities/testing/live-harness'
import { selectCapabilitiesLayer } from '@b2b-saas-starter/capabilities/runtime'
import { RateLimiter } from '@b2b-saas-starter/api'
import { expect, layer } from '@effect/vitest'
import { DateTime, Effect, Layer, Schema } from 'effect'
import { HttpRouter } from 'effect/unstable/http'
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose'
import { buildWebHandler } from './http.ts'
import { mcpProtocolLayer } from './mcp.ts'
import { makeOAuthTokenVerifier, OAuthTokenVerifier } from './oauth-access-token.ts'
import { jsonBody, mcpClient } from './test-utils.ts'

const allow = { limit: () => Promise.resolve({ success: true }) }
const rateBindings = { RATE_LIMITER_MCP: allow, RATE_LIMITER_REST_WRITE: allow }
const envelope = Schema.Struct({
  result: Schema.Struct({
    isError: Schema.optional(Schema.Boolean),
    content: Schema.Array(Schema.Struct({ text: Schema.String }))
  })
})
const decodeRecord = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Struct({ id: Schema.String }))
)
const decodeDownload = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Struct({ url: Schema.String, expiresAt: Schema.String }))
)
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
function execute(sql: string, ...values: ReadonlyArray<string | number>) {
  return Effect.flatMap(TestD1, (db) =>
    Effect.promise(() =>
      db
        .prepare(sql)
        .bind(...values)
        .run()
    )
  )
}
const TOKEN_INSERT = `INSERT INTO api_tokens (id,workspace_id,name,token_prefix,token_hash,scopes,created_at) VALUES (?, ?, 'MCP live test', 'bsk_test', ?, '["admin"]', '2026-01-01T00:00:00Z')`

layer(TestDatabase, { timeout: LIVE_SUITE_TIMEOUT })('MCP live boundaries', (it) => {
  it.effect(
    'existing foreign IDs cannot disclose or mutate another tenant',
    () =>
      Effect.gen(function* () {
        const DB = yield* TestD1
        yield* execute(
          `INSERT INTO passkey (id,userId,publicKey,credentialID,counter,deviceType,backedUp,createdAt)
          VALUES ('pk_mcp_live_owner','usr_owner','fixture-public-key','credential_mcp_live_owner',0,'singleDevice',0,strftime('%s','now'))`
        )
        yield* execute(
          `INSERT INTO session (id,token,userId,expiresAt,createdAt,updatedAt,strongAuthAt,strongAuthMethod,strongAuthCredentialId)
          VALUES ('ses_mcp_live_owner','tok_mcp_live_owner','usr_owner',strftime('%s','now')+3600,strftime('%s','now'),strftime('%s','now'),strftime('%s','now'),'passkey','pk_mcp_live_owner')`
        )
        const own = 'bsk_own_live'
        const foreign = 'bsk_foreign_live'
        yield* execute(
          TOKEN_INSERT,
          'tok_live_own',
          'wrk_live',
          yield* Effect.promise(() => hashApiToken(own))
        )
        yield* execute(
          TOKEN_INSERT,
          'tok_live_foreign',
          'wrk_other',
          yield* Effect.promise(() => hashApiToken(foreign))
        )
        const { handler } = buildWebHandler({ DB, ...rateBindings })
        const client = mcpClient(handler, `Bearer ${own}`)
        const other = mcpClient(handler, `Bearer ${foreign}`)
        yield* Effect.promise(() => client.initialize())
        yield* Effect.promise(() => other.initialize())
        const created = yield* call(other, 'create_webhook', {
          url: 'https://foreign.example/hook',
          events: ['api_token.created']
        })
        expect(created.isError).not.toBe(true)
        const endpoint = yield* decodeRecord(created.content[0]?.text)
        const before = yield* call(other, 'list_webhooks')
        const audit = yield* call(other, 'list_audit_events')
        for (const name of [
          'update_webhook',
          'delete_webhook',
          'rotate_webhook_secret',
          'send_webhook_test_event'
        ]) {
          const refusal = yield* call(client, name, {
            endpointId: endpoint.id,
            enabled: false
          })
          expect(refusal.isError).toBe(true)
          expect(refusal.content[0]?.text).toBe('webhook endpoint not found')
        }
        expect(
          (yield* call(client, 'delete_api_token', { tokenId: 'tok_live_foreign' }))
            .isError
        ).not.toBe(true)
        expect(yield* call(other, 'list_webhooks')).toEqual(before)
        expect(yield* call(other, 'list_audit_events')).toEqual(audit)
        // The foreign credential is still valid; the own credential can be revoked.
        yield* call(client, 'delete_api_token', { tokenId: 'tok_live_own' })
        expect(
          (yield* Effect.promise(() =>
            client.rpc('tools/call', {
              name: 'create_webhook',
              arguments: {
                url: 'https://blocked.example',
                events: ['api_token.created']
              }
            })
          )).status
        ).toBe(401)
      }),
    120_000
  )

  it.effect(
    'Live missing and rejected queues preserve exactly one pending row per call',
    () =>
      Effect.gen(function* () {
        const DB = yield* TestD1
        yield* execute(
          TOKEN_INSERT,
          'tok_queue_test',
          'wrk_dev_contract',
          yield* Effect.promise(() => hashApiToken(SEED_API_TOKEN))
        )
        const missing = mcpClient(
          buildWebHandler({ DB, ...rateBindings }).handler,
          `Bearer ${SEED_API_TOKEN}`
        )
        yield* Effect.promise(() => missing.initialize())
        const created = yield* call(missing, 'create_webhook', {
          url: 'https://queue.example/hook',
          events: ['api_token.created']
        })
        const endpoint = yield* decodeRecord(created.content[0]?.text)
        const refused = yield* call(missing, 'send_webhook_test_event', {
          endpointId: endpoint.id
        })
        expect(refused.isError).toBe(true)
        expect(refused.content[0]?.text).toContain('enqueue was not confirmed')
        let attempts = 0
        const queue = {
          send: () => {
            attempts += 1
            return Promise.reject('send acknowledgement lost')
          },
          sendBatch: () => Promise.resolve()
        }
        const failing = mcpClient(
          buildWebHandler({ DB, WEBHOOK_QUEUE: queue, ...rateBindings }).handler,
          `Bearer ${SEED_API_TOKEN}`
        )
        yield* Effect.promise(() => failing.initialize())
        expect(
          (yield* call(failing, 'send_webhook_test_event', { endpointId: endpoint.id }))
            .isError
        ).toBe(true)
        expect(attempts).toBe(1)
        const rows = yield* Effect.promise(() =>
          DB.prepare('SELECT status FROM webhook_deliveries WHERE endpoint_id = ?')
            .bind(endpoint.id)
            .all()
        )
        expect(rows.results).toEqual([{ status: 'pending' }, { status: 'pending' }])
      })
  )

  it.effect(
    'the same signed OAuth credential observes real demotion, removal and consent versions',
    () =>
      Effect.gen(function* () {
        const DB = yield* TestD1
        const issuer = 'https://issuer.test/api/auth'
        const audience = 'https://api.test/mcp'
        const clientId = 'live-oauth-client'
        yield* execute(
          `INSERT INTO oauth_client (id,clientId,redirectUris,disabled) VALUES ('client-live', ?, '[]', 0)`,
          clientId
        )
        yield* execute(
          `INSERT INTO oauth_consent (id,userId,clientId,referenceId,scopes) VALUES ('consent-live','usr_owner',?,'wrk_dev_contract','["mcp:read","mcp:write"]')`,
          clientId
        )
        const keys = yield* Effect.promise(() => generateKeyPair('EdDSA'))
        const jwk = yield* Effect.promise(() => exportJWK(keys.publicKey))
        const verifier = Layer.succeed(OAuthTokenVerifier)(
          makeOAuthTokenVerifier(
            { issuer, audience },
            createLocalJWKSet({ keys: [jwk] })
          )
        )
        const handler = HttpRouter.toWebHandler(
          mcpProtocolLayer({ DB }).pipe(
            Layer.provide(
              Layer.mergeAll(
                selectCapabilitiesLayer({ DB }),
                verifier,
                Layer.succeed(RateLimiter)({ take: () => Effect.succeed(true) })
              )
            )
          ),
          { disableLogger: true }
        ).handler
        function token(binding: string) {
          return Effect.promise(() =>
            new SignJWT({
              sub: 'usr_owner',
              client_id: clientId,
              scope: 'mcp:read mcp:write',
              starter_workspace_id: 'wrk_dev_contract',
              starter_workspace_slug: 'dev-contract-lab',
              starter_workspace_role: 'owner',
              starter_consent_binding: binding,
              starter_session_id: 'ses_mcp_live_owner'
            })
              .setProtectedHeader({ alg: 'EdDSA' })
              .setIssuer(issuer)
              .setAudience(audience)
              .setIssuedAt()
              .setExpirationTime('1h')
              .sign(keys.privateKey)
          )
        }
        const jwt = yield* token('consent-live:0')
        const client = mcpClient(handler, `Bearer ${jwt}`)
        yield* Effect.promise(() => client.initialize())
        const created = yield* call(client, 'create_webhook', {
          url: 'https://oauth.example/hook',
          events: ['api_token.created']
        })
        const endpoint = yield* decodeRecord(created.content[0]?.text)
        yield* execute(
          `UPDATE workspace_members SET role='member' WHERE id='mem_dev_contract_owner'`
        )
        expect(
          (yield* call(client, 'delete_webhook', { endpointId: endpoint.id })).isError
        ).toBe(true)
        yield* execute(
          `DELETE FROM workspace_members WHERE id='mem_dev_contract_owner'`
        )
        expect(
          (yield* call(client, 'delete_webhook', { endpointId: endpoint.id }))
            .content[0]?.text
        ).toBe('workspace not found')
        yield* execute(
          `INSERT INTO workspace_members (id,workspaceId,userId,role) VALUES ('mem_dev_contract_owner','wrk_dev_contract','usr_owner','owner')`
        )
        // No clock advance: restoring identical scope text still changes the binding.
        yield* execute(
          `UPDATE oauth_consent SET scopes='["mcp:read"]' WHERE id='consent-live'`
        )
        yield* execute(
          `UPDATE oauth_consent SET scopes='["mcp:read","mcp:write"]' WHERE id='consent-live'`
        )
        expect(
          (yield* call(client, 'delete_webhook', { endpointId: endpoint.id })).isError
        ).toBe(true)
        const fresh = mcpClient(handler, `Bearer ${yield* token('consent-live:2')}`)
        yield* Effect.promise(() => fresh.initialize())
        expect(
          (yield* call(fresh, 'rotate_webhook_secret', { endpointId: endpoint.id }))
            .isError
        ).not.toBe(true)
        yield* execute(`DELETE FROM oauth_consent WHERE id='consent-live'`)
        yield* execute(
          `INSERT INTO oauth_consent (id,userId,clientId,referenceId,scopes) VALUES ('consent-new','usr_owner',?,'wrk_dev_contract','["mcp:read","mcp:write"]')`,
          clientId
        )
        expect(
          (yield* call(fresh, 'delete_webhook', { endpointId: endpoint.id })).isError
        ).toBe(true)
      })
  )
  it.effect(
    'exports preserve pending, failed, foreign, and expired refusals and cap URL lifetime',
    () =>
      Effect.gen(function* () {
        const DB = yield* TestD1
        const token = 'bsk_exports_live'
        yield* execute(
          TOKEN_INSERT,
          'tok_exports_live',
          'wrk_dev_contract',
          yield* Effect.promise(() => hashApiToken(token))
        )
        const client = mcpClient(
          buildWebHandler({ DB, ...rateBindings }).handler,
          `Bearer ${token}`
        )
        yield* Effect.promise(() => client.initialize())
        expect((yield* call(client, 'request_workspace_export')).isError).toBe(true)
        for (const status of ['pending', 'failed', 'ready']) {
          yield* execute(
            `INSERT INTO workspace_exports (id,workspace_id,status,object_key,size_bytes,download_secret,created_at,expires_at) VALUES (?, 'wrk_dev_contract', ?, 'archive', 10, 'test_export_secret', '2026-01-01T00:00:00Z', '2099-01-01T00:00:00Z')`,
            `exp_${status}`,
            status
          )
        }
        yield* execute(
          `INSERT INTO workspace_exports (id,workspace_id,status,object_key,size_bytes,download_secret,created_at,expires_at) VALUES ('exp_foreign', 'wrk_other', 'ready', 'archive', 10, 'foreign_export_secret', '2026-01-01T00:00:00Z', '2099-01-01T00:00:00Z')`
        )
        for (const exportId of [
          'exp_pending',
          'exp_failed',
          'exp_foreign',
          'exp_missing'
        ]) {
          expect(
            (yield* call(client, 'get_workspace_export_download_link', { exportId }))
              .content[0]?.text
          ).toBe('workspace export not downloadable')
        }
        const first = yield* decodeDownload(
          (yield* call(client, 'get_workspace_export_download_link', {
            exportId: 'exp_ready'
          })).content[0]?.text
        )
        const horizon = DateTime.formatIso(
          DateTime.subtract(DateTime.makeUnsafe(first.expiresAt), { minutes: 5 })
        )
        yield* execute(
          'UPDATE workspace_exports SET expires_at=? WHERE id=?',
          horizon,
          'exp_ready'
        )
        const capped = yield* decodeDownload(
          (yield* call(client, 'get_workspace_export_download_link', {
            exportId: 'exp_ready'
          })).content[0]?.text
        )
        expect(capped.expiresAt).toBe(horizon)
        yield* execute(
          "UPDATE workspace_exports SET expires_at='2000-01-01T00:00:00Z' WHERE id='exp_ready'"
        )
        expect(
          (yield* call(client, 'get_workspace_export_download_link', {
            exportId: 'exp_ready'
          })).content[0]?.text
        ).toBe('workspace export not downloadable')
      })
  )
})
