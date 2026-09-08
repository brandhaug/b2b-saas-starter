import { WebhookDeliveryAttempt } from '@b2b-saas-starter/capabilities/developer-platform/webhook-delivery-plan'
import { SEED_API_TOKEN } from '@b2b-saas-starter/capabilities/developer-platform/api-token-registry'
import { signWorkspaceExportDownload } from '@b2b-saas-starter/capabilities/governance/workspace-export'
import { seedWorkspaceExportFixture } from '@b2b-saas-starter/capabilities/seed-fixture'
import { describe, expect, it, vi } from '@effect/vitest'
import { DateTime, Effect, Schema } from 'effect'
import { type ApiEnv } from './env.ts'
import { buildWebHandler } from './http.ts'

// Response bodies are decoded at the boundary rather than cast: a contract
// shape change fails the decode, which is exactly what these tests assert.
const ErrorBody = Schema.Struct({ _tag: Schema.String })
const HealthBody = Schema.Struct({ status: Schema.Literal('ok') })
const OpenApiBody = Schema.Struct({
  openapi: Schema.String,
  paths: Schema.Record(Schema.String, Schema.Unknown)
})
const OverviewBody = Schema.Struct({
  workspace: Schema.Struct({ slug: Schema.String }),
  notifications: Schema.Array(Schema.Unknown)
})
const CreatedTokenBody = Schema.Struct({
  id: Schema.String,
  token: Schema.String,
  scopes: Schema.Array(Schema.String)
})
const CreatedWebhookBody = Schema.Struct({
  url: Schema.String,
  enabled: Schema.Boolean
})
const CreatedEndpointIdBody = Schema.Struct({ id: Schema.String })
const UpdatedWebhookBody = Schema.Struct({
  id: Schema.String,
  url: Schema.String,
  enabled: Schema.Boolean,
  events: Schema.Array(Schema.String)
})
const DeletedBody = Schema.Struct({ status: Schema.Literal('deleted') })
const RotatedSecretBody = Schema.Struct({ signingSecret: Schema.String })
const QueuedDeliveryBody = Schema.Struct({
  status: Schema.Literal('queued'),
  deliveryId: Schema.String
})
const DeliveriesBody = Schema.Array(
  Schema.Struct({
    id: Schema.String,
    endpointId: Schema.String,
    eventType: Schema.String,
    status: Schema.String,
    attempts: Schema.Number,
    responseStatus: Schema.NullOr(Schema.Number),
    payload: Schema.NullOr(Schema.Unknown),
    requestHeaders: Schema.NullOr(Schema.Record(Schema.String, Schema.String)),
    responseBody: Schema.NullOr(Schema.String),
    replayedFrom: Schema.NullOr(Schema.String)
  })
)
const AssistantAnswerBody = Schema.Struct({
  provider: Schema.String,
  assistantConfigured: Schema.Boolean
})
const McpDiscoveryBody = Schema.Struct({ name: Schema.String })
const ExportBody = Schema.Struct({ id: Schema.String, status: Schema.String })
const DownloadLinkBody = Schema.Struct({ url: Schema.String, expiresAt: Schema.String })

// Request payloads leave through the same JSON codec the contract decodes.
const encodeJsonBody = Schema.encodeSync(Schema.fromJsonString(Schema.Json))

const bearer = { authorization: `Bearer ${SEED_API_TOKEN}` }

// One handler for the whole file, like production's cached per-isolate
// handler: requests share the Seed layer's in-memory stores, so a mutation
// made by one request is visible to the next (the seed fixture resets per
// build, and rebuilding per request would hide exactly that).
const sharedHandler = buildWebHandler({}).handler

function handlerFor(env: ApiEnv): (request: Request) => Promise<Response> {
  // Tests that inject bindings (rate-limit denials) build their own handler;
  // the seed-backed default shares the file-wide instance above.
  if (Object.keys(env).length === 0) {
    return sharedHandler
  }
  return buildWebHandler(env).handler
}

function get(path: string, headers?: Record<string, string>): Request {
  if (!headers) {
    return new Request(`https://api.test${path}`)
  }
  return new Request(`https://api.test${path}`, { headers })
}

function post(
  path: string,
  body: typeof Schema.Json.Type,
  headers?: Record<string, string>
): Request {
  return new Request(`https://api.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: encodeJsonBody(body)
  })
}

/** Drives the worker's web handler; the fetch boundary is the promise edge. */
function send(request: Request, env: ApiEnv = {}): Effect.Effect<Response> {
  return Effect.promise(() => handlerFor(env)(request))
}

function jsonBody<S extends Schema.Top>(response: Response, schema: S) {
  return Effect.promise(() => response.json()).pipe(
    Effect.flatMap((body) => Schema.decodeUnknownEffect(schema)(body))
  )
}

describe('contract-served routes', () => {
  it.effect('GET /health is public and returns ok', () =>
    Effect.gen(function* () {
      const res = yield* send(get('/health'))
      expect(res.status).toBe(200)
      expect(yield* jsonBody(res, HealthBody)).toEqual({ status: 'ok' })
    })
  )

  it.effect('GET /ready reports missing database dependency', () =>
    Effect.gen(function* () {
      const res = yield* send(get('/ready'))
      expect(res.status).toBe(503)
      expect(
        yield* jsonBody(res, Schema.Struct({ status: Schema.Literal('not_ready') }))
      ).toEqual({
        status: 'not_ready'
      })
    })
  )

  it.effect('GET /openapi.json is generated from the contract', () =>
    Effect.gen(function* () {
      const res = yield* send(get('/openapi.json'))
      expect(res.status).toBe(200)
      const doc = yield* jsonBody(res, OpenApiBody)
      expect(doc.openapi).toBeDefined()
      expect(doc.paths['/workspaces/{slug}/overview']).toBeDefined()
      expect(doc.paths['/workspaces/{slug}/webhooks']).toBeDefined()
      expect(doc.paths['/health']).toBeDefined()
      // The published contract must not advertise a surface the worker cannot
      // serve. See the 404 test below and issue #64.
      expect(doc.paths['/workspaces/{slug}/invitations']).toBeUndefined()
    })
  )

  it.effect('GET /reference serves the Scalar UI', () =>
    Effect.gen(function* () {
      const res = yield* send(get('/reference'))
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toContain('text/html')
    })
  )

  it.effect('protected routes require a bearer token', () =>
    Effect.gen(function* () {
      const res = yield* send(get('/workspaces/starter-lab/overview'))
      expect(res.status).toBe(401)
      expect((yield* jsonBody(res, ErrorBody))._tag).toBe('Unauthorized')
    })
  )

  it.effect('unknown bearer tokens are authentication failures', () =>
    Effect.gen(function* () {
      const res = yield* send(
        get('/workspaces/starter-lab/overview', {
          authorization: 'Bearer bsk_live_bogus'
        })
      )
      expect(res.status).toBe(401)
    })
  )

  it.effect('workspace tokens cannot cross workspace slugs', () =>
    Effect.gen(function* () {
      const res = yield* send(get('/workspaces/does-not-exist/overview', bearer))
      expect(res.status).toBe(403)
      expect((yield* jsonBody(res, ErrorBody))._tag).toBe('AuthorizationDenied')
    })
  )

  // The read-only token's whole route table lives in `permission-matrix.test.ts`,
  // which asserts every gated operation the contract advertises. Keeping one
  // permitted read and two denials here as well only duplicated three of its rows.

  it.effect('GET workspace overview returns the DTO for the seed token', () =>
    Effect.gen(function* () {
      const res = yield* send(get('/workspaces/starter-lab/overview', bearer))
      expect(res.status).toBe(200)
      const body = yield* jsonBody(res, OverviewBody)
      expect(body.workspace.slug).toBe('starter-lab')
      expect(Array.isArray(body.notifications)).toBe(true)
    })
  )

  it.effect('POST create api token returns 201 with the created token', () =>
    Effect.gen(function* () {
      const res = yield* send(
        post(
          '/workspaces/starter-lab/api-tokens',
          { name: 'CI token', scopes: ['read'] },
          bearer
        )
      )
      expect(res.status).toBe(201)
      const body = yield* jsonBody(res, CreatedTokenBody)
      expect(body.token).toBeTruthy()
      expect(body.scopes).toEqual(['read'])
      const auditResponse = yield* send(
        get('/workspaces/starter-lab/audit-events?eventType=api_token.created', bearer)
      )
      expect(auditResponse.status).toBe(200)
      const audit = yield* jsonBody(
        auditResponse,
        Schema.Struct({
          items: Schema.Array(
            Schema.Struct({
              targetId: Schema.NullOr(Schema.String),
              actorType: Schema.String
            })
          )
        })
      )
      expect(audit.items.find((event) => event.targetId === body.id)?.actorType).toBe(
        'api_token'
      )
    })
  )

  it.effect(
    'revoking removes the token projection and repeated revocation still succeeds',
    () =>
      Effect.gen(function* () {
        const created = yield* send(
          post(
            '/workspaces/starter-lab/api-tokens',
            {
              name: 'Revocation test',
              scopes: ['read']
            },
            bearer
          )
        )
        expect(created.status).toBe(201)
        const token = yield* jsonBody(created, CreatedTokenBody)
        const TokenPage = Schema.Struct({
          items: Schema.Array(Schema.Struct({ id: Schema.String }))
        })
        const before = yield* send(get('/workspaces/starter-lab/api-tokens', bearer))
        expect(
          (yield* jsonBody(before, TokenPage)).items.some(
            (item) => item.id === token.id
          )
        ).toBe(true)
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const revoked = yield* send(
            new Request(
              `https://api.test/workspaces/starter-lab/api-tokens/${token.id}`,
              {
                method: 'DELETE',
                headers: bearer
              }
            )
          )
          expect(revoked.status).toBe(200)
          expect(
            yield* jsonBody(
              revoked,
              Schema.Struct({ status: Schema.Literal('revoked') })
            )
          ).toEqual({ status: 'revoked' })
        }
        const after = yield* send(get('/workspaces/starter-lab/api-tokens', bearer))
        expect(
          (yield* jsonBody(after, TokenPage)).items.some((item) => item.id === token.id)
        ).toBe(false)
      })
  )

  for (const route of [
    { path: 'webhooks/wh_absent/rotate-secret', tag: 'WebhookEndpointNotFound' },
    { path: 'webhooks/wh_absent/test-event', tag: 'WebhookEndpointNotFound' },
    { path: 'webhooks/deliveries/whd_absent/replay', tag: 'WebhookDeliveryNotFound' }
  ]) {
    it.effect(`${route.path} preserves the typed 404`, () =>
      Effect.gen(function* () {
        const response = yield* send(
          post(`/workspaces/starter-lab/${route.path}`, {}, bearer)
        )
        expect(response.status).toBe(404)
        expect((yield* jsonBody(response, ErrorBody))._tag).toBe(route.tag)
      })
    )
  }

  it.effect('POST create webhook rejects invalid destinations', () =>
    Effect.gen(function* () {
      const res = yield* send(
        post(
          '/workspaces/starter-lab/webhooks',
          { url: 'http://insecure.example.com/hook', events: ['api_token.created'] },
          bearer
        )
      )
      expect(res.status).toBe(400)
      expect((yield* jsonBody(res, ErrorBody))._tag).toBe('InvalidWebhookUrl')
    })
  )

  it.effect('POST create webhook accepts https destinations', () =>
    Effect.gen(function* () {
      const res = yield* send(
        post(
          '/workspaces/starter-lab/webhooks',
          { url: 'https://example.com/hook', events: ['api_token.created'] },
          bearer
        )
      )
      expect(res.status).toBe(201)
      const body = yield* jsonBody(res, CreatedWebhookBody)
      expect(body.url).toBe('https://example.com/hook')
      expect(body.enabled).toBe(true)
    })
  )

  it.effect('PATCH webhook endpoint updates the provided fields', () =>
    Effect.gen(function* () {
      function patch(payload: typeof Schema.Json.Type) {
        return send(
          new Request('https://api.test/workspaces/starter-lab/webhooks/wh_release', {
            method: 'PATCH',
            headers: { 'content-type': 'application/json', ...bearer },
            body: encodeJsonBody(payload)
          })
        )
      }
      const res = yield* patch({ enabled: false })
      expect(res.status).toBe(200)
      const body = yield* jsonBody(res, UpdatedWebhookBody)
      // Only the provided field changed; URL and subscriptions are intact.
      expect(body.enabled).toBe(false)
      expect(body.url).toBe('https://example.com/webhooks/starter')
      expect(body.events).toEqual(['api_token.created'])
      // Put the endpoint back: later tests dispatch to it.
      const reEnabled = yield* patch({ enabled: true })
      expect((yield* jsonBody(reEnabled, UpdatedWebhookBody)).enabled).toBe(true)
    })
  )

  it.effect('PATCH webhook endpoint re-validates the URL and 404s unknown ids', () =>
    Effect.gen(function* () {
      function patch(endpointId: string, payload: typeof Schema.Json.Type) {
        return send(
          new Request(
            `https://api.test/workspaces/starter-lab/webhooks/${endpointId}`,
            {
              method: 'PATCH',
              headers: { 'content-type': 'application/json', ...bearer },
              body: encodeJsonBody(payload)
            }
          )
        )
      }
      const invalid = yield* patch('wh_release', { url: 'http://localhost/hook' })
      expect(invalid.status).toBe(400)
      expect((yield* jsonBody(invalid, ErrorBody))._tag).toBe('InvalidWebhookUrl')
      const missing = yield* patch('wh_missing', { enabled: true })
      expect(missing.status).toBe(404)
      expect((yield* jsonBody(missing, ErrorBody))._tag).toBe('WebhookEndpointNotFound')
    })
  )

  it.effect('DELETE webhook endpoint removes it and 404s when nothing matches', () =>
    Effect.gen(function* () {
      // Create a throwaway endpoint so the seed fixture stays intact for the
      // other tests in this file.
      const created = yield* send(
        post(
          '/workspaces/starter-lab/webhooks',
          { url: 'https://example.com/doomed', events: ['api_token.revoked'] },
          bearer
        )
      )
      const createdBody = yield* jsonBody(created, CreatedEndpointIdBody)
      const res = yield* send(
        new Request(
          `https://api.test/workspaces/starter-lab/webhooks/${createdBody.id}`,
          {
            method: 'DELETE',
            headers: bearer
          }
        )
      )
      expect(res.status).toBe(200)
      expect(yield* jsonBody(res, DeletedBody)).toEqual({ status: 'deleted' })
      const again = yield* send(
        new Request(
          `https://api.test/workspaces/starter-lab/webhooks/${createdBody.id}`,
          {
            method: 'DELETE',
            headers: bearer
          }
        )
      )
      expect(again.status).toBe(404)
    })
  )

  it.effect('POST rotate-secret returns the new secret once', () =>
    Effect.gen(function* () {
      const res = yield* send(
        post('/workspaces/starter-lab/webhooks/wh_release/rotate-secret', {}, bearer)
      )
      expect(res.status).toBe(200)
      const body = yield* jsonBody(res, RotatedSecretBody)
      expect(body.signingSecret).toMatch(/^whsec_/)
      const missing = yield* send(
        post('/workspaces/starter-lab/webhooks/wh_missing/rotate-secret', {}, bearer)
      )
      expect(missing.status).toBe(404)
    })
  )

  it.effect('POST test-event queues a synthetic webhook.test_event delivery', () =>
    Effect.gen(function* () {
      const res = yield* send(
        post('/workspaces/starter-lab/webhooks/wh_release/test-event', {}, bearer)
      )
      expect(res.status).toBe(201)
      const body = yield* jsonBody(res, QueuedDeliveryBody)
      expect(body.status).toBe('queued')
      expect(body.deliveryId).toBeTruthy()
      // The pending delivery lists back through the read surface.
      const deliveries = yield* send(
        get('/workspaces/starter-lab/webhooks/wh_release/deliveries', bearer)
      )
      const rows = yield* jsonBody(deliveries, DeliveriesBody)
      const pending = rows.find((row) => row.id === body.deliveryId)
      expect(pending).toMatchObject({
        status: 'pending',
        attempts: 0,
        eventType: 'webhook.test_event'
      })
    })
  )

  it.effect(
    'POST replay-delivery re-enqueues a failed delivery as a pending copy',
    () =>
      Effect.gen(function* () {
        const res = yield* send(
          post(
            '/workspaces/starter-lab/webhooks/deliveries/whd_seed_failed/replay',
            {},
            bearer
          )
        )
        expect(res.status).toBe(201)
        const body = yield* jsonBody(res, QueuedDeliveryBody)
        expect(body.deliveryId).not.toBe('whd_seed_failed')

        const deliveries = yield* send(
          get('/workspaces/starter-lab/webhooks/wh_release/deliveries', bearer)
        )
        const rows = yield* jsonBody(deliveries, DeliveriesBody)
        const copy = rows.find((row) => row.id === body.deliveryId)
        expect(copy).toMatchObject({
          status: 'pending',
          attempts: 0,
          replayedFrom: 'whd_seed_failed'
        })
        // The recorded payload rides on the copy verbatim.
        expect(copy?.payload).toEqual({ tokenId: 'tok_docs', name: 'Docs automation' })

        // A delivered row refuses the replay; an unknown id reads as not found.
        const delivered = yield* send(
          post(
            `/workspaces/starter-lab/webhooks/deliveries/${body.deliveryId}/replay`,
            {},
            bearer
          )
        )
        expect(delivered.status).toBe(409)
        expect((yield* jsonBody(delivered, ErrorBody))._tag).toBe(
          'WebhookDispatchRejected'
        )
        const missing = yield* send(
          post(
            '/workspaces/starter-lab/webhooks/deliveries/whd_missing/replay',
            {},
            bearer
          )
        )
        expect(missing.status).toBe(404)
      })
  )

  it.effect('GET webhook deliveries lists recorded evidence for one endpoint', () =>
    Effect.gen(function* () {
      const res = yield* send(
        get('/workspaces/starter-lab/webhooks/wh_release/deliveries', bearer)
      )
      expect(res.status).toBe(200)
      const rows = yield* jsonBody(res, DeliveriesBody)
      const failed = rows.find((row) => row.id === 'whd_seed_failed')
      expect(failed).toMatchObject({
        status: 'failed',
        responseStatus: 500,
        replayedFrom: null
      })
      expect(failed?.requestHeaders?.['webhook-id']).toBe('whd_seed_failed')
      expect(failed?.responseBody).toContain('upstream')
    })
  )

  it.effect(
    'GET attempt history returns retained evidence and hides missing deliveries',
    () =>
      Effect.gen(function* () {
        const response = yield* send(
          get(
            '/workspaces/starter-lab/webhooks/deliveries/whd_seed_failed/attempts',
            bearer
          )
        )
        expect(response.status).toBe(200)
        const attempts = yield* jsonBody(response, Schema.Array(WebhookDeliveryAttempt))
        expect(attempts.length).toBeGreaterThan(0)
        expect(
          attempts.every((attempt) => attempt.deliveryId === 'whd_seed_failed')
        ).toBe(true)
        const missing = yield* send(
          get(
            '/workspaces/starter-lab/webhooks/deliveries/whd_foreign/attempts',
            bearer
          )
        )
        expect(missing.status).toBe(200)
        expect(yield* jsonBody(missing, Schema.Array(WebhookDeliveryAttempt))).toEqual(
          []
        )
      })
  )

  // Issue #64: the worker has no session to offer Better Auth's organization
  // plugin, so it cannot persist an invitation. The endpoint used to email a
  // link carrying no invitation id, which no recipient could ever accept, so
  // the route is gone rather than left emailing a dead link.
  it.effect('POST invitations is not served: the worker cannot persist one', () =>
    Effect.gen(function* () {
      const res = yield* send(
        post(
          '/workspaces/starter-lab/invitations',
          { to: 'invitee@example.com' },
          bearer
        )
      )
      expect(res.status).toBe(404)
    })
  )

  it.effect(
    'POST assistant answer returns a mock reply when authorized and unconfigured',
    () =>
      Effect.gen(function* () {
        const res = yield* send(
          post(
            '/assistant/answer',
            { workspaceSlug: 'starter-lab', question: 'What is this?' },
            bearer
          )
        )
        expect(res.status).toBe(200)
        const body = yield* jsonBody(res, AssistantAnswerBody)
        expect(body.provider).toBe('mock')
        expect(body.assistantConfigured).toBe(false)
      })
  )

  it.effect('GET /mcp/discovery returns the discovery document when authorized', () =>
    Effect.gen(function* () {
      const res = yield* send(get('/mcp/discovery', bearer))
      expect(res.status).toBe(200)
      expect((yield* jsonBody(res, McpDiscoveryBody)).name).toBe('b2b-saas-starter-mcp')
    })
  )

  it.effect('a denying rate-limit binding short-circuits with 429', () =>
    Effect.gen(function* () {
      const denyAssistant: ApiEnv = {
        RATE_LIMITER_ASSISTANT: { limit: () => Promise.resolve({ success: false }) }
      }
      const res = yield* send(
        post('/assistant/answer', {
          workspaceSlug: 'starter-lab',
          question: 'Hi'
        }),
        denyAssistant
      )
      expect(res.status).toBe(429)
      expect((yield* jsonBody(res, ErrorBody))._tag).toBe('RateLimited')
    })
  )

  it.effect('GET / serves the root index', () =>
    Effect.gen(function* () {
      const res = yield* send(get('/'))
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toContain('application/json')
      const body = yield* jsonBody(
        res,
        Schema.Struct({
          name: Schema.Literal('b2b-saas-starter-api'),
          health: Schema.Literal('/health'),
          openapi: Schema.Literal('/openapi.json'),
          docs: Schema.Literal('/reference'),
          mcp: Schema.Literal('/mcp'),
          mcpDiscovery: Schema.Literal('/mcp/discovery')
        })
      )
      expect(body.docs).toBe('/reference')
    })
  )

  it.effect('unknown routes are 404', () =>
    Effect.gen(function* () {
      const res = yield* send(get('/nope'))
      expect(res.status).toBe(404)
    })
  )
})

/**
 * The one canonical line per request, as `Logger.consoleJson` prints it. The
 * shape is decoded rather than cast, so a logger format change fails here
 * instead of reading `undefined`.
 */
const WideEventLine = Schema.Struct({
  message: Schema.Unknown,
  annotations: Schema.Record(Schema.String, Schema.Unknown)
})
const decodeWideEventLine = Schema.decodeUnknownSync(
  Schema.fromJsonString(WideEventLine)
)

const encodeWideEventLines = Schema.encodeSync(
  Schema.fromJsonString(Schema.Array(WideEventLine))
)

describe('request observability', () => {
  it.effect('the wide event carries the Cloudflare colo the request arrived at', () => {
    const lines: Array<typeof WideEventLine.Type> = []
    const captureLine = vi
      .spyOn(console, 'log')
      .mockImplementation((...args: ReadonlyArray<unknown>) => {
        lines.push(decodeWideEventLine(args[0]))
      })
    const request = get('/health?token=customer-sensitive-canary')
    // What Cloudflare hands a Worker: the `cf` object the envelope mines for
    // the colo. `undici`'s `Request` has none, so the platform field is
    // attached here the way the runtime would.
    Object.defineProperty(request, 'cf', { value: { colo: 'ARN' } })

    return Effect.gen(function* () {
      const res = yield* send(request)
      expect(res.status).toBe(200)

      const events = lines.filter((line) => line.message === 'request.health')
      // Exactly one event per request, and it names the colo as its region.
      expect(events).toHaveLength(1)
      expect(encodeWideEventLines(events)).not.toContain('customer-sensitive-canary')
      expect(events[0]?.annotations['pathname']).toBeUndefined()
      expect(events[0]?.annotations).toMatchObject({
        service: 'api',
        status: 'ok',
        method: 'GET',
        region: 'ARN'
      })
    }).pipe(Effect.ensuring(Effect.sync(() => captureLine.mockRestore())))
  })
})

describe('workspace exports (ADR 0055)', () => {
  it.effect(
    'POST /workspaces/:slug/exports requests an export with the owner-set token',
    () =>
      Effect.gen(function* () {
        const res = yield* send(post('/workspaces/starter-lab/exports', {}, bearer))
        expect(res.status).toBe(202)
        const body = yield* jsonBody(res, ExportBody)
        // The Seed adapter has no queue: the row lands ready inline.
        expect(body.status).toBe('ready')
      })
  )

  it.effect('POST …/exports/:exportId/download-link mints a link on this origin', () =>
    Effect.gen(function* () {
      const res = yield* send(
        post(
          `/workspaces/starter-lab/exports/${seedWorkspaceExportFixture.id}/download-link`,
          {},
          bearer
        )
      )
      expect(res.status).toBe(200)
      const body = yield* jsonBody(res, DownloadLinkBody)
      expect(body.url).toMatch(
        /^https:\/\/api\.test\/exports\/exp_seed_ready\/download\?expires=\d+&signature=[0-9a-f]{64}$/
      )
      // The minted link is honoured by the public route, on a fresh handler
      // whose Seed adapter shares nothing but the fixture secret.
      const download = yield* send(new Request(body.url))
      expect(download.status).toBe(200)
      expect(download.headers.get('content-type')).toContain('application/gzip')
      expect(download.headers.get('content-disposition')).toContain(
        'starter-lab-export-exp_seed_ready.json.gz'
      )
      const bytes = new Uint8Array(yield* Effect.promise(() => download.arrayBuffer()))
      // Gzip magic bytes: 0x1f 0x8b.
      expect([...bytes.subarray(0, 2)]).toEqual([0x1f, 0x8b])
    })
  )

  it.effect('download-link resolves origin per request on the same handler', () =>
    Effect.gen(function* () {
      for (const origin of ['https://first.api.test', 'https://second.api.test']) {
        const response = yield* send(
          new Request(
            `${origin}/workspaces/starter-lab/exports/${seedWorkspaceExportFixture.id}/download-link`,
            { method: 'POST', headers: bearer }
          )
        )
        expect(response.status).toBe(200)
        const link = yield* jsonBody(response, DownloadLinkBody)
        expect(new URL(link.url).origin).toBe(origin)
      }
    })
  )

  it.effect(
    'download-link answers 404 for an export this workspace cannot hand out',
    () =>
      Effect.gen(function* () {
        const res = yield* send(
          post('/workspaces/starter-lab/exports/exp_nope/download-link', {}, bearer)
        )
        expect(res.status).toBe(404)
        expect((yield* jsonBody(res, ErrorBody))._tag).toBe(
          'WorkspaceExportNotDownloadable'
        )
      })
  )

  // `it.live`, not `it.effect`: the test mints the link against `DateTime.now`
  // and the handler validates it against the real clock, so the TestClock's
  // epoch-zero time would read as an already-expired signature.
  it.live(
    'GET /exports/:id/download is public but refuses a bad or missing signature',
    () =>
      Effect.gen(function* () {
        const now = yield* DateTime.now
        const expires = Math.floor(DateTime.toEpochMillis(now) / 1000) + 600
        const signature = yield* signWorkspaceExportDownload(
          seedWorkspaceExportFixture.downloadSecret,
          seedWorkspaceExportFixture.id,
          expires
        )
        const valid = yield* send(
          get(
            `/exports/${seedWorkspaceExportFixture.id}/download?expires=${expires}&signature=${signature}`
          )
        )
        expect(valid.status).toBe(200)

        const tampered = yield* send(
          get(
            `/exports/${seedWorkspaceExportFixture.id}/download?expires=${expires + 1}&signature=${signature}`
          )
        )
        expect(tampered.status).toBe(404)
        const missing = yield* send(
          get(`/exports/${seedWorkspaceExportFixture.id}/download`)
        )
        expect(missing.status).toBe(404)
        const unknown = yield* send(
          get(`/exports/exp_nope/download?expires=${expires}&signature=${signature}`)
        )
        expect(unknown.status).toBe(404)
      })
  )

  it.effect('the signed download route is not advertised by the contract', () =>
    Effect.gen(function* () {
      const res = yield* send(get('/openapi.json'))
      const doc = yield* jsonBody(res, OpenApiBody)
      expect(doc.paths['/exports/{exportId}/download']).toBeUndefined()
      expect(doc.paths['/workspaces/{slug}/exports']).toBeDefined()
    })
  )
})
