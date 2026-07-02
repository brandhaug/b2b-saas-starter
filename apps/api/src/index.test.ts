import { Effect, Layer, type Scope } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  ApiTokenRegistry,
  AuthorizationDenied,
  CapabilityUnavailable,
  SEED_API_TOKEN,
  SeedApiTokenRegistry,
  type ApiTokenRegistryShape,
  type ApiTokenScope
} from '@b2b-saas-starter/capabilities'
import worker from './index.ts'
import { authorize } from './auth.ts'
import { matchRoute } from './routes.ts'
import { clientKey, makeRateLimiterLayer, RateLimiter } from './rate-limit.ts'

const get = (path: string, headers?: Record<string, string>): Request =>
  new Request(`http://localhost${path}`, { headers: headers ?? {} })

const post = (
  path: string,
  body?: unknown,
  headers?: Record<string, string>
): Request =>
  new Request(`http://localhost${path}`, {
    method: 'POST',
    body: JSON.stringify(body ?? {}),
    headers: { 'content-type': 'application/json', ...headers }
  })

const bearer = (token: string): Record<string, string> => ({
  authorization: `Bearer ${token}`
})

// `authorize` and the rate limiter annotate the request's wide event, so they
// need a Scope; tests supply it with `Effect.scoped` after providing layers.
const runScoped = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>): Promise<A> =>
  Effect.runPromise(Effect.scoped(effect) as Effect.Effect<A, E>)

describe('matchRoute', () => {
  const match = (request: Request) => matchRoute(request, {})

  it('requires only read scope for workspace GET lists, including api-tokens and webhooks', () => {
    for (const resource of [
      'overview',
      'modules',
      'api-tokens',
      'webhooks',
      'audit-events'
    ]) {
      const matched = match(get(`/workspaces/starter-lab/${resource}`))
      expect(matched?.kind).toBe('workspace')
      expect(matched?.requiredScope).toBe('read')
      if (matched?.kind === 'workspace') expect(matched.slug).toBe('starter-lab')
    }
  })

  it('requires admin scope for token create and revoke', () => {
    const create = match(post('/workspaces/starter-lab/api-tokens'))
    expect(create?.event).toBe('workspace.api-tokens.create')
    expect(create?.requiredScope).toBe('admin')

    const revoke = match(post('/workspaces/starter-lab/api-tokens/tok_1/revoke'))
    expect(revoke?.event).toBe('workspace.api-tokens.revoke')
    expect(revoke?.requiredScope).toBe('admin')

    const remove = match(
      new Request('http://localhost/workspaces/starter-lab/api-tokens/tok_1', {
        method: 'DELETE'
      })
    )
    expect(remove?.event).toBe('workspace.api-tokens.revoke')
    expect(remove?.requiredScope).toBe('admin')
  })

  it('rejects the revoke/delete method-path cross-product the contract never defined', () => {
    expect(match(post('/workspaces/starter-lab/api-tokens/tok_1'))).toBeNull()
    expect(
      match(
        new Request('http://localhost/workspaces/starter-lab/api-tokens/tok_1/revoke', {
          method: 'DELETE'
        })
      )
    ).toBeNull()
  })

  it('requires write scope for webhook create', () => {
    const matched = match(post('/workspaces/starter-lab/webhooks'))
    expect(matched?.kind).toBe('workspace')
    expect(matched?.event).toBe('workspace.webhooks.create')
    expect(matched?.requiredScope).toBe('write')
  })

  it('requires read scope on the assistant, catalog, and mcp routes', () => {
    expect(match(post('/assistant/answer'))?.requiredScope).toBe('read')
    expect(match(get('/catalog/modules'))?.requiredScope).toBe('read')
    expect(match(get('/mcp'))?.requiredScope).toBe('read')
  })

  it('leaves health, openapi, and reference unauthenticated', () => {
    for (const path of ['/health', '/openapi.json', '/reference']) {
      const matched = match(get(path))
      expect(matched?.kind).toBe('standalone')
      expect(matched?.requiredScope).toBeUndefined()
    }
  })

  it('returns null for unknown paths and wrong methods', () => {
    expect(match(get('/nope'))).toBeNull()
    expect(match(post('/workspaces/starter-lab/modules'))).toBeNull()
    expect(match(get('/assistant/answer'))).toBeNull()
  })
})

describe('authorize', () => {
  const seedRegistry = SeedApiTokenRegistry([])

  const stubRegistry = (
    verify: ApiTokenRegistryShape['verifyBearerToken']
  ): Layer.Layer<ApiTokenRegistry> =>
    Layer.succeed(ApiTokenRegistry)({
      list: Effect.succeed([]),
      create: () => Effect.die('unused in authorize tests'),
      revoke: () => Effect.die('unused in authorize tests'),
      verifyBearerToken: verify
    })

  const runAuthorize = (
    request: Request,
    scope: ApiTokenScope,
    expectedSlug?: string,
    registry: Layer.Layer<ApiTokenRegistry> = seedRegistry
  ) => runScoped(authorize(request, scope, expectedSlug).pipe(Effect.provide(registry)))

  it('answers 401 when the bearer token is missing', async () => {
    const denied = await runAuthorize(get('/workspaces/starter-lab/modules'), 'read')
    expect(denied?.status).toBe(401)
    expect(await denied?.json()).toEqual({ error: 'missing_bearer_token' })
  })

  it('answers 401 for an unknown token', async () => {
    const denied = await runAuthorize(
      get('/workspaces/starter-lab/modules', bearer('bsk_live_bogus')),
      'read'
    )
    expect(denied?.status).toBe(401)
    expect(await denied?.json()).toEqual({ error: 'invalid_token' })
  })

  it('answers 403 when a valid token is bound to a different workspace', async () => {
    const denied = await runAuthorize(
      get('/workspaces/another-workspace/modules', bearer(SEED_API_TOKEN)),
      'read',
      'another-workspace'
    )
    expect(denied?.status).toBe(403)
    expect(await denied?.json()).toEqual({ error: 'token_workspace_mismatch' })
  })

  it('answers 403 when the token lacks the required scope', async () => {
    const denied = await runAuthorize(
      get('/workspaces/starter-lab/api-tokens', bearer('bsk_live_read_only')),
      'admin',
      'starter-lab',
      stubRegistry(() =>
        Effect.fail(new AuthorizationDenied({ reason: 'insufficient_scope' }))
      )
    )
    expect(denied?.status).toBe(403)
    expect(await denied?.json()).toEqual({ error: 'insufficient_scope' })
  })

  it('answers 503 when the token store is unreachable', async () => {
    const denied = await runAuthorize(
      get('/workspaces/starter-lab/modules', bearer('bsk_live_any')),
      'read',
      'starter-lab',
      stubRegistry(() =>
        Effect.fail(
          new CapabilityUnavailable({
            capability: 'api-token-registry',
            reason: 'd1 unreachable'
          })
        )
      )
    )
    expect(denied?.status).toBe(503)
    expect(await denied?.json()).toEqual({ error: 'capability_unavailable' })
  })

  it('passes the seed token for its own workspace', async () => {
    const denied = await runAuthorize(
      get('/workspaces/starter-lab/modules', bearer(SEED_API_TOKEN)),
      'read',
      'starter-lab'
    )
    expect(denied).toBeNull()
  })
})

describe('worker fetch (seed layers, no bindings)', () => {
  const fetch = (request: Request) => worker.fetch(request, {})

  it('serves health without auth', async () => {
    const response = await fetch(get('/health'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok' })
  })

  it('rejects a workspace read without a token', async () => {
    const response = await fetch(get('/workspaces/starter-lab/modules'))
    expect(response.status).toBe(401)
  })

  it('does not resolve an unknown workspace before requiring a token', async () => {
    const response = await fetch(get('/workspaces/unknown-workspace/modules'))
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'missing_bearer_token' })
  })

  it('rejects a workspace read with an unknown token', async () => {
    const response = await fetch(
      get('/workspaces/starter-lab/modules', bearer('bsk_live_bogus'))
    )
    expect(response.status).toBe(401)
  })

  it('serves a workspace read with the seed token', async () => {
    const response = await fetch(
      get('/workspaces/starter-lab/modules', bearer(SEED_API_TOKEN))
    )
    expect(response.status).toBe(200)
    const modules = (await response.json()) as unknown[]
    expect(modules.length).toBeGreaterThan(0)
  })

  it('rejects a valid token bound to a different workspace slug', async () => {
    const response = await fetch(
      get('/workspaces/unknown-workspace/modules', bearer(SEED_API_TOKEN))
    )
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'token_workspace_mismatch' })
  })

  it('rejects an invalid webhook destination with 400 before persisting', async () => {
    const response = await fetch(
      post(
        '/workspaces/starter-lab/webhooks',
        { url: 'http://insecure.example.com/hook', events: ['api_token.created'] },
        bearer(SEED_API_TOKEN)
      )
    )
    expect(response.status).toBe(400)
    const body = (await response.json()) as { error: string }
    expect(body.error).toBe('invalid_webhook_url')
  })

  it('creates a webhook endpoint for a valid https destination', async () => {
    const response = await fetch(
      post(
        '/workspaces/starter-lab/webhooks',
        { url: 'https://example.com/hook', events: ['api_token.created'] },
        bearer(SEED_API_TOKEN)
      )
    )
    expect(response.status).toBe(201)
    const body = (await response.json()) as { url: string; enabled: boolean }
    expect(body.url).toBe('https://example.com/hook')
    expect(body.enabled).toBe(true)
  })

  // Invitation validation lives in `SendInvitationPayload` (packages/api) —
  // the schema is the whole contract, no imperative checks in the worker.
  it('rejects an invitation to a non-email recipient with 400', async () => {
    const response = await fetch(
      post(
        '/workspaces/starter-lab/invitations',
        { to: 'not-an-email' },
        bearer(SEED_API_TOKEN)
      )
    )
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'invalid_invitation_input' })
  })

  it('queues an invitation for a valid recipient', async () => {
    const response = await fetch(
      post(
        '/workspaces/starter-lab/invitations',
        { to: 'teammate@example.com' },
        bearer(SEED_API_TOKEN)
      )
    )
    expect(response.status).toBe(202)
    const body = (await response.json()) as { status: string }
    expect(body.status).toBe('queued')
  })
})

describe('rate limiter fallback (no Cloudflare bindings)', () => {
  it('enforces the in-memory per-bucket limit and keys buckets independently', async () => {
    const take = (key: string) =>
      Effect.gen(function* () {
        const limiter = yield* RateLimiter
        return yield* limiter.take({ bucket: 'rest_write', key })
      }).pipe(Effect.provide(makeRateLimiterLayer({})))

    const key = `test-${Date.now()}-${Math.random()}`
    const outcomes: boolean[] = []
    for (let i = 0; i < 21; i += 1) {
      outcomes.push(await runScoped(take(key)))
    }
    // rest_write allows 20 per window; the 21st take is denied.
    expect(outcomes.slice(0, 20).every(Boolean)).toBe(true)
    expect(outcomes[20]).toBe(false)
    // A different key is unaffected.
    expect(await runScoped(take(`${key}-other`))).toBe(true)
  })
})

describe('clientKey', () => {
  it('uses cf-connecting-ip and ignores attacker-controlled x-forwarded-for', () => {
    const request = get('/mcp', {
      'cf-connecting-ip': '203.0.113.7',
      'x-forwarded-for': '10.0.0.1'
    })
    expect(clientKey(request)).toBe('203.0.113.7')
  })

  it('falls back to a path-derived key when no client ip is present', () => {
    const request = get('/mcp', { 'x-forwarded-for': '10.0.0.1' })
    expect(clientKey(request)).toBe('unkeyed:/mcp')
  })
})
