import { hashSha256 } from '@b2b-saas-starter/capabilities/crypto'
import {
  LIVE_SUITE_TIMEOUT,
  TestDatabase,
  TestD1
} from '@b2b-saas-starter/capabilities/testing/live-harness'
import { expect, layer } from '@effect/vitest'
import { Effect, Schema } from 'effect'
import { buildWebHandler } from './http.ts'
import { jsonBody } from './test-utils.ts'

const record = Schema.Struct({ id: Schema.String })
const page = Schema.Struct({
  items: Schema.Array(record),
  nextCursor: Schema.NullOr(Schema.String)
})
const allow = { limit: () => Promise.resolve({ success: true }) }

layer(TestDatabase, { timeout: LIVE_SUITE_TIMEOUT })(
  'REST Workspace isolation',
  (it) => {
    it.effect(
      'substituted Workspace and record IDs disclose nothing and leave foreign state intact',
      () =>
        Effect.gen(function* () {
          const DB = yield* TestD1
          const own = 'bsk_isolation_rest_own'
          const foreign = 'bsk_isolation_rest_foreign'
          const reader = 'bsk_isolation_rest_reader'
          for (const [id, workspaceId, token, scopes] of [
            ['tok_isolation_own', 'wrk_dev_contract', own, '["admin"]'],
            ['tok_isolation_foreign', 'wrk_other', foreign, '["admin"]'],
            ['tok_isolation_reader', 'wrk_dev_contract', reader, '["read"]']
          ] satisfies ReadonlyArray<readonly [string, string, string, string]>) {
            const hash = yield* Effect.promise(() => hashSha256(token))
            yield* Effect.promise(() =>
              DB.prepare(
                `INSERT INTO api_tokens (id,workspace_id,name,token_prefix,token_hash,scopes,created_at) VALUES (?, ?, 'Isolation', 'bsk_test', ?, ?, '2026-01-01T00:00:00Z')`
              )
                .bind(id, workspaceId, hash, scopes)
                .run()
            )
          }
          yield* Effect.promise(() =>
            DB.prepare(`INSERT INTO notifications (id,workspace_id,title,message,created_at) VALUES
            ('not_rest_a1','wrk_dev_contract','Own first','Own','2026-01-01T00:00:00Z'),
            ('not_rest_a2','wrk_dev_contract','Own second','Own','2026-01-02T00:00:00Z'),
            ('not_rest_b1','wrk_other','Private first','Private','2026-01-01T00:00:00Z'),
            ('not_rest_b2','wrk_other','Private second','Private','2026-01-02T00:00:00Z')`).run()
          )
          let queued = 0
          const { handler } = buildWebHandler({
            DB,
            RATE_LIMITER_REST: allow,
            RATE_LIMITER_REST_WRITE: allow,
            WEBHOOK_QUEUE: {
              send: () => {
                queued += 1
                return Promise.resolve()
              },
              sendBatch: () => Promise.resolve()
            }
          })
          function request(
            token: string,
            slug: string,
            path: string,
            method = 'GET',
            body?: string
          ) {
            const options: RequestInit = {
              method,
              headers: {
                authorization: `Bearer ${token}`,
                'content-type': 'application/json'
              }
            }
            if (body !== undefined) {
              options.body = body
            }
            return Effect.promise(() =>
              handler(
                new Request(`https://api.test/workspaces/${slug}/${path}`, options)
              )
            )
          }
          const created = yield* request(
            foreign,
            'other-lab',
            'webhooks',
            'POST',
            '{"url":"https://private.example/hook","events":["api_token.created"]}'
          )
          expect(created.status).toBe(201)
          const endpoint = yield* jsonBody(created, record)
          const ownCreated = yield* request(
            own,
            'dev-contract-lab',
            'webhooks',
            'POST',
            '{"url":"https://own.example/hook","events":["api_token.created"]}'
          )
          expect(ownCreated.status).toBe(201)
          const ownEndpoint = yield* jsonBody(ownCreated, record)
          expect((yield* request(reader, 'dev-contract-lab', 'overview')).status).toBe(
            200
          )
          expect(
            (yield* request(
              reader,
              'dev-contract-lab',
              `webhooks/${ownEndpoint.id}`,
              'DELETE'
            )).status
          ).toBe(403)
          const sent = yield* request(
            foreign,
            'other-lab',
            `webhooks/${endpoint.id}/test-event`,
            'POST'
          )
          expect(sent.status).toBe(201)
          const delivery = yield* jsonBody(
            sent,
            Schema.Struct({ deliveryId: Schema.String })
          )
          yield* Effect.promise(() =>
            DB.prepare(
              `INSERT INTO webhook_delivery_attempts (id,delivery_id,attempts,phase,status,attempted_at,response_body) VALUES ('attempt_rest_foreign',?,1,'http','failed','2026-01-01T00:00:00Z','Private receiver response')`
            )
              .bind(delivery.deliveryId)
              .run()
          )
          const foreignDeliveries = yield* request(
            foreign,
            'other-lab',
            `webhooks/${endpoint.id}/deliveries`
          ).pipe(Effect.flatMap((response) => jsonBody(response, Schema.Array(record))))
          expect(foreignDeliveries).toEqual([{ id: delivery.deliveryId }])
          const foreignAttempts = yield* request(
            foreign,
            'other-lab',
            `webhooks/deliveries/${delivery.deliveryId}/attempts`
          ).pipe(
            Effect.flatMap((response) =>
              jsonBody(
                response,
                Schema.Array(
                  Schema.Struct({
                    id: Schema.String,
                    responseBody: Schema.NullOr(Schema.String)
                  })
                )
              )
            )
          )
          expect(foreignAttempts).toEqual([
            { id: 'attempt_rest_foreign', responseBody: 'Private receiver response' }
          ])
          const before = yield* request(foreign, 'other-lab', 'webhooks').pipe(
            Effect.flatMap((r) => jsonBody(r, Schema.Json))
          )
          const auditBefore = yield* request(foreign, 'other-lab', 'audit-events').pipe(
            Effect.flatMap((r) => jsonBody(r, Schema.Json))
          )
          const foreignPage = yield* request(
            foreign,
            'other-lab',
            'notifications?limit=1'
          ).pipe(Effect.flatMap((response) => jsonBody(response, page)))
          expect(foreignPage.items).toEqual([{ id: 'not_rest_b2' }])
          expect(foreignPage.nextCursor).not.toBeNull()
          const cursor = encodeURIComponent(foreignPage.nextCursor ?? '')
          const resumed = yield* request(
            foreign,
            'other-lab',
            `notifications?limit=1&cursor=${cursor}`
          ).pipe(Effect.flatMap((response) => jsonBody(response, page)))
          expect(resumed.items).toEqual([{ id: 'not_rest_b1' }])
          expect(resumed.nextCursor).toBeNull()
          const substituted = yield* request(
            own,
            'dev-contract-lab',
            `notifications?limit=10&cursor=${cursor}`
          ).pipe(Effect.flatMap((response) => jsonBody(response, page)))
          expect(substituted.items.map((item) => item.id)).toEqual([
            'not_rest_a2',
            'not_rest_a1'
          ])
          expect(substituted.nextCursor).toBeNull()
          const queuedBefore = queued
          for (const slug of ['other-lab', 'missing-lab']) {
            for (const path of [
              'overview',
              'webhooks?limit=1',
              'audit-events?limit=1',
              `webhooks/${endpoint.id}/deliveries`
            ]) {
              const denied = yield* request(own, slug, path)
              expect(denied.status).toBe(403)
              expect(yield* jsonBody(denied, Schema.Json)).toEqual({
                _tag: 'AuthorizationDenied',
                reason: 'token_workspace_mismatch'
              })
            }
          }
          for (const [method, suffix, body] of [
            ['PATCH', '', '{"enabled":false}'],
            ['DELETE', '', undefined],
            ['POST', '/rotate-secret', undefined],
            ['POST', '/test-event', undefined]
          ] satisfies ReadonlyArray<readonly [string, string, string | undefined]>) {
            const foreignResult = yield* request(
              own,
              'dev-contract-lab',
              `webhooks/${endpoint.id}${suffix}`,
              method,
              body
            )
            const absentResult = yield* request(
              own,
              'dev-contract-lab',
              `webhooks/missing${suffix}`,
              method,
              body
            )
            expect(foreignResult.status).toBe(404)
            expect(yield* jsonBody(foreignResult, Schema.Json)).toEqual({
              _tag: 'WebhookEndpointNotFound',
              endpointId: endpoint.id
            })
            expect(yield* jsonBody(absentResult, Schema.Json)).toEqual({
              _tag: 'WebhookEndpointNotFound',
              endpointId: 'missing'
            })
          }
          for (const path of [
            `webhooks/${endpoint.id}/deliveries`,
            `webhooks/deliveries/${delivery.deliveryId}/attempts`
          ]) {
            const hidden = yield* request(own, 'dev-contract-lab', path)
            expect(hidden.status).toBe(200)
            expect(yield* jsonBody(hidden, Schema.Json)).toEqual([])
          }
          const replay = yield* request(
            own,
            'dev-contract-lab',
            `webhooks/deliveries/${delivery.deliveryId}/replay`,
            'POST'
          )
          expect(replay.status).toBe(404)
          const ownPage = yield* request(
            own,
            'dev-contract-lab',
            'webhooks?limit=1'
          ).pipe(Effect.flatMap((r) => jsonBody(r, page)))
          expect(ownPage.items).toEqual([{ id: ownEndpoint.id }])
          expect(ownPage.nextCursor).toBeNull()
          expect(
            yield* request(foreign, 'other-lab', 'webhooks').pipe(
              Effect.flatMap((r) => jsonBody(r, Schema.Json))
            )
          ).toEqual(before)
          expect(
            yield* request(foreign, 'other-lab', 'audit-events').pipe(
              Effect.flatMap((r) => jsonBody(r, Schema.Json))
            )
          ).toEqual(auditBefore)
          expect(queued).toBe(queuedBefore)
          expect(
            (yield* request(
              own,
              'dev-contract-lab',
              'api-tokens/tok_isolation_foreign',
              'DELETE'
            )).status
          ).toBe(200)
          expect((yield* request(foreign, 'other-lab', 'overview')).status).toBe(200)
          expect(
            (yield* request(
              own,
              'dev-contract-lab',
              'api-tokens/tok_isolation_own',
              'DELETE'
            )).status
          ).toBe(200)
          expect((yield* request(own, 'dev-contract-lab', 'overview')).status).toBe(401)
          expect(
            (yield* request(
              own,
              'dev-contract-lab',
              `webhooks/${ownEndpoint.id}`,
              'DELETE'
            )).status
          ).toBe(401)
          const retained = yield* request(reader, 'dev-contract-lab', 'webhooks').pipe(
            Effect.flatMap((response) => jsonBody(response, page))
          )
          expect(retained.items).toEqual([{ id: ownEndpoint.id }])
        }),
      120_000
    )
  }
)
