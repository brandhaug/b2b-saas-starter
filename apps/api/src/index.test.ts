import { SEED_API_TOKEN } from '@b2b-saas-starter/capabilities/developer-platform/api-token-registry'
import { describe, expect, test } from 'vitest'
import { Effect, Schema } from 'effect'
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
  token: Schema.String,
  scopes: Schema.Array(Schema.String)
})
const CreatedWebhookBody = Schema.Struct({
  url: Schema.String,
  enabled: Schema.Boolean
})
const AssistantAnswerBody = Schema.Struct({
  provider: Schema.String,
  assistantConfigured: Schema.Boolean
})
const McpDiscoveryBody = Schema.Struct({ name: Schema.String })

// Request payloads leave through the same JSON codec the contract decodes.
const encodeJsonBody = Schema.encodeSync(Schema.fromJsonString(Schema.Json))

const bearer = { authorization: `Bearer ${SEED_API_TOKEN}` }

function handlerFor(env: ApiEnv): (request: Request) => Promise<Response> {
  return buildWebHandler(env).handler
}

function get(path: string, headers?: Record<string, string>): Request {
  if (!headers) return new Request(`https://api.test${path}`)
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

function jsonBody<S extends Schema.Top>(
  response: Response,
  schema: S
): Effect.Effect<S['Type'], never, S['DecodingServices']> {
  return Effect.promise(() => response.json()).pipe(
    Effect.flatMap((body) => Schema.decodeUnknownEffect(schema)(body)),
    Effect.orDie
  )
}

describe('contract-served routes', () => {
  test('GET /health is public and returns ok', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const res = yield* send(get('/health'))
        expect(res.status).toBe(200)
        expect(yield* jsonBody(res, HealthBody)).toEqual({ status: 'ok' })
      })
    ))

  test('GET /openapi.json is generated from the contract', () =>
    Effect.runPromise(
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
    ))

  test('GET /reference serves the Scalar UI', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const res = yield* send(get('/reference'))
        expect(res.status).toBe(200)
        expect(res.headers.get('content-type')).toContain('text/html')
      })
    ))

  test('protected routes require a bearer token', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const res = yield* send(get('/workspaces/starter-lab/overview'))
        expect(res.status).toBe(401)
        expect((yield* jsonBody(res, ErrorBody))._tag).toBe('Unauthorized')
      })
    ))

  test('unknown bearer tokens are authentication failures', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const res = yield* send(
          get('/workspaces/starter-lab/overview', {
            authorization: 'Bearer bsk_live_bogus'
          })
        )
        expect(res.status).toBe(401)
      })
    ))

  test('workspace tokens cannot cross workspace slugs', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const res = yield* send(get('/workspaces/does-not-exist/overview', bearer))
        expect(res.status).toBe(403)
        expect((yield* jsonBody(res, ErrorBody))._tag).toBe('AuthorizationDenied')
      })
    ))

  // The read-only token's whole route table lives in `permission-matrix.test.ts`,
  // which asserts every gated operation the contract advertises. Keeping one
  // permitted read and two denials here as well only duplicated three of its rows.

  test('GET workspace overview returns the DTO for the seed token', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const res = yield* send(get('/workspaces/starter-lab/overview', bearer))
        expect(res.status).toBe(200)
        const body = yield* jsonBody(res, OverviewBody)
        expect(body.workspace.slug).toBe('starter-lab')
        expect(Array.isArray(body.notifications)).toBe(true)
      })
    ))

  test('POST create api token returns 201 with the created token', () =>
    Effect.runPromise(
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
      })
    ))

  test('POST create webhook rejects invalid destinations', () =>
    Effect.runPromise(
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
    ))

  test('POST create webhook accepts https destinations', () =>
    Effect.runPromise(
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
    ))

  // Issue #64: the worker has no session to offer Better Auth's organization
  // plugin, so it cannot persist an invitation. The endpoint used to email a
  // link carrying no invitation id, which no recipient could ever accept, so
  // the route is gone rather than left emailing a dead link.
  test('POST invitations is not served: the worker cannot persist one', () =>
    Effect.runPromise(
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
    ))

  test('POST assistant answer returns a mock reply when authorized and unconfigured', () =>
    Effect.runPromise(
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
    ))

  test('GET /mcp returns the discovery document when authorized', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const res = yield* send(get('/mcp', bearer))
        expect(res.status).toBe(200)
        expect((yield* jsonBody(res, McpDiscoveryBody)).name).toBe(
          'b2b-saas-starter-mcp'
        )
      })
    ))

  test('a denying rate-limit binding short-circuits with 429', () =>
    Effect.runPromise(
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
    ))

  test('unknown routes are 404', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const res = yield* send(get('/nope'))
        expect(res.status).toBe(404)
      })
    ))
})
