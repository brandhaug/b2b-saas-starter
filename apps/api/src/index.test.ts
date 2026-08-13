import { describe, expect, it } from '@effect/vitest'
import { Effect, Schema } from 'effect'
import { SEED_API_TOKEN } from '@b2b-saas-starter/capabilities'
import type { ApiEnv } from './env.ts'
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
  modules: Schema.Array(Schema.Unknown)
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
  it.effect('GET /health is public and returns ok', () =>
    Effect.gen(function* () {
      const res = yield* send(get('/health'))
      expect(res.status).toBe(200)
      expect(yield* jsonBody(res, HealthBody)).toEqual({ status: 'ok' })
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

  it.effect('GET workspace overview returns the DTO for the seed token', () =>
    Effect.gen(function* () {
      const res = yield* send(get('/workspaces/starter-lab/overview', bearer))
      expect(res.status).toBe(200)
      const body = yield* jsonBody(res, OverviewBody)
      expect(body.workspace.slug).toBe('starter-lab')
      expect(Array.isArray(body.modules)).toBe(true)
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
    })
  )

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

  it.effect('POST invitations validates email through the contract schema', () =>
    Effect.gen(function* () {
      const res = yield* send(
        post('/workspaces/starter-lab/invitations', { to: 'not-an-email' }, bearer)
      )
      expect(res.status).toBe(400)
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

  it.effect('GET /mcp returns the discovery document when authorized', () =>
    Effect.gen(function* () {
      const res = yield* send(get('/mcp', bearer))
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

  it.effect('unknown routes are 404', () =>
    Effect.gen(function* () {
      const res = yield* send(get('/nope'))
      expect(res.status).toBe(404)
    })
  )
})
