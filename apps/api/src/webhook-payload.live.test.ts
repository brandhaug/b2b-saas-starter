import { hashSha256 } from '@b2b-saas-starter/capabilities/crypto'
import {
  LIVE_SUITE_TIMEOUT,
  TestDatabase,
  TestD1
} from '@b2b-saas-starter/capabilities/testing/live-harness'
import { expect, layer } from '@effect/vitest'
import { Effect, Schema } from 'effect'
import { buildWebHandler } from './http.ts'
import { jsonBody, mcpClient } from './test-utils.ts'

// Failure modes: oversized fields accepted at create or update, MCP bypassing
// REST validation, and rejected requests changing either endpoint or audit rows.
const oversized = [
  { url: `https://hooks.example/${'x'.repeat(2048)}` },
  { events: Array.from({ length: 101 }, () => 'custom.event') },
  { events: ['x'.repeat(129)] }
]
const encode = Schema.encodeSync(Schema.fromJsonString(Schema.Json))

layer(TestDatabase, { timeout: LIVE_SUITE_TIMEOUT })(
  'webhook payload admission',
  (it) => {
    it.effect(
      'REST and MCP reject oversized fields before persisting endpoints or audits',
      () =>
        Effect.gen(function* () {
          const DB = yield* TestD1
          const token = 'bsk_payload_bounds'
          const hash = yield* Effect.promise(() => hashSha256(token))
          yield* Effect.promise(() =>
            DB.prepare(
              `INSERT INTO api_tokens (id,workspace_id,name,token_prefix,token_hash,scopes,created_at) VALUES ('tok_payload_bounds','wrk_dev_contract','Payload bounds','bsk_test',?,'["admin"]','2026-01-01T00:00:00Z')`
            )
              .bind(hash)
              .run()
          )
          const allow = { limit: () => Promise.resolve({ success: true }) }
          const { handler } = buildWebHandler({
            DB,
            RATE_LIMITER_REST_WRITE: allow,
            RATE_LIMITER_MCP: allow
          })
          const path = 'https://api.test/workspaces/dev-contract-lab/webhooks'
          function request(method: string, url: string, body: Schema.Json) {
            return Effect.promise(() =>
              handler(
                new Request(url, {
                  method,
                  headers: {
                    authorization: `Bearer ${token}`,
                    'content-type': 'application/json'
                  },
                  body: encode(body)
                })
              )
            )
          }
          const valid = {
            url: 'https://hooks.example/receive',
            events: ['custom.event']
          }
          const created = yield* request('POST', path, valid)
          expect(created.status).toBe(201)
          const endpoint = yield* jsonBody(
            created,
            Schema.Struct({ id: Schema.String })
          )
          function snapshot() {
            return Effect.promise(() =>
              DB.prepare(
                `SELECT id,url,events,description FROM webhook_endpoints WHERE workspace_id='wrk_dev_contract'`
              ).all()
            )
          }
          function audit() {
            return Effect.promise(() =>
              DB.prepare(
                `SELECT id FROM audit_events WHERE workspace_id='wrk_dev_contract'`
              ).all()
            )
          }
          const before = yield* snapshot()
          const auditBefore = yield* audit()
          const client = mcpClient(handler, `Bearer ${token}`)
          yield* Effect.promise(() => client.initialize())
          for (const payload of [...oversized, { description: 'x'.repeat(2001) }]) {
            expect(
              (yield* request('POST', path, { ...valid, ...payload })).status
            ).toBe(400)
            const response = yield* Effect.promise(() =>
              client.rpc('tools/call', {
                name: 'create_webhook',
                arguments: { ...valid, ...payload }
              })
            )
            const body = yield* jsonBody(response, Schema.JsonObject)
            if (body.error === undefined) {
              expect(body.result).toMatchObject({ isError: true })
            } else {
              expect(body.error).toMatchObject({ code: expect.any(Number) })
            }
          }
          for (const payload of oversized) {
            expect(
              (yield* request('PATCH', `${path}/${endpoint.id}`, payload)).status
            ).toBe(400)
          }
          expect((yield* snapshot()).results).toEqual(before.results)
          expect((yield* audit()).results).toEqual(auditBefore.results)
        })
    )
  }
)
