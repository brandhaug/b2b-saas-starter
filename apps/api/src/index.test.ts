import { describe, expect, test } from 'vitest'
import { SEED_API_TOKEN } from '@b2b-saas-starter/capabilities'
import type { ApiEnv } from './env.ts'
import { buildWebHandler } from './http.ts'

const handlerFor = (env: ApiEnv = {}) => buildWebHandler(env).handler

const bearer = { authorization: `Bearer ${SEED_API_TOKEN}` }

const get = (path: string, headers?: Record<string, string>) =>
  new Request(`https://api.test${path}`, headers ? { headers } : {})

const post = (path: string, body: unknown, headers?: Record<string, string>) =>
  new Request(`https://api.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body)
  })

describe('contract-served routes', () => {
  test('GET /health is public and returns ok', async () => {
    const res = await handlerFor()(get('/health'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
  })

  test('GET /openapi.json is generated from the contract', async () => {
    const res = await handlerFor()(get('/openapi.json'))
    expect(res.status).toBe(200)
    const doc = (await res.json()) as {
      openapi?: string
      paths?: Record<string, unknown>
    }
    expect(doc.openapi).toBeDefined()
    expect(doc.paths?.['/workspaces/{slug}/overview']).toBeDefined()
    expect(doc.paths?.['/workspaces/{slug}/webhooks']).toBeDefined()
    expect(doc.paths?.['/health']).toBeDefined()
  })

  test('GET /reference serves the Scalar UI', async () => {
    const res = await handlerFor()(get('/reference'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
  })

  test('protected routes require a bearer token', async () => {
    const res = await handlerFor()(get('/workspaces/starter-lab/overview'))
    expect(res.status).toBe(401)
    expect(((await res.json()) as { _tag: string })._tag).toBe('Unauthorized')
  })

  test('unknown bearer tokens are authentication failures', async () => {
    const res = await handlerFor()(
      get('/workspaces/starter-lab/overview', {
        authorization: 'Bearer bsk_live_bogus'
      })
    )
    expect(res.status).toBe(401)
  })

  test('workspace tokens cannot cross workspace slugs', async () => {
    const res = await handlerFor()(get('/workspaces/does-not-exist/overview', bearer))
    expect(res.status).toBe(403)
    expect(((await res.json()) as { _tag: string })._tag).toBe('AuthorizationDenied')
  })

  test('GET workspace overview returns the DTO for the seed token', async () => {
    const res = await handlerFor()(get('/workspaces/starter-lab/overview', bearer))
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      workspace: { slug: string }
      modules: unknown[]
    }
    expect(body.workspace.slug).toBe('starter-lab')
    expect(Array.isArray(body.modules)).toBe(true)
  })

  test('POST create api token returns 201 with the created token', async () => {
    const res = await handlerFor()(
      post(
        '/workspaces/starter-lab/api-tokens',
        { name: 'CI token', scopes: ['read'] },
        bearer
      )
    )
    expect(res.status).toBe(201)
    const body = (await res.json()) as { token: string; scopes: string[] }
    expect(body.token).toBeTruthy()
    expect(body.scopes).toEqual(['read'])
  })

  test('POST create webhook rejects invalid destinations', async () => {
    const res = await handlerFor()(
      post(
        '/workspaces/starter-lab/webhooks',
        { url: 'http://insecure.example.com/hook', events: ['api_token.created'] },
        bearer
      )
    )
    expect(res.status).toBe(400)
    expect(((await res.json()) as { _tag: string })._tag).toBe('InvalidWebhookUrl')
  })

  test('POST create webhook accepts https destinations', async () => {
    const res = await handlerFor()(
      post(
        '/workspaces/starter-lab/webhooks',
        { url: 'https://example.com/hook', events: ['api_token.created'] },
        bearer
      )
    )
    expect(res.status).toBe(201)
    const body = (await res.json()) as { url: string; enabled: boolean }
    expect(body.url).toBe('https://example.com/hook')
    expect(body.enabled).toBe(true)
  })

  test('POST invitations validates email through the contract schema', async () => {
    const res = await handlerFor()(
      post('/workspaces/starter-lab/invitations', { to: 'not-an-email' }, bearer)
    )
    expect(res.status).toBe(400)
  })

  test('POST assistant answer returns a mock reply when authorized and unconfigured', async () => {
    const res = await handlerFor()(
      post(
        '/assistant/answer',
        { workspaceSlug: 'starter-lab', question: 'What is this?' },
        bearer
      )
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      provider: string
      assistantConfigured: boolean
    }
    expect(body.provider).toBe('mock')
    expect(body.assistantConfigured).toBe(false)
  })

  test('GET /mcp returns the discovery document when authorized', async () => {
    const res = await handlerFor()(get('/mcp', bearer))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { name: string }
    expect(body.name).toBe('b2b-saas-starter-mcp')
  })

  test('a denying rate-limit binding short-circuits with 429', async () => {
    const denyAssistant: ApiEnv = {
      RATE_LIMITER_ASSISTANT: { limit: async () => ({ success: false }) }
    }
    const res = await handlerFor(denyAssistant)(
      post('/assistant/answer', { workspaceSlug: 'starter-lab', question: 'Hi' })
    )
    expect(res.status).toBe(429)
    expect(((await res.json()) as { _tag: string })._tag).toBe('RateLimited')
  })

  test('unknown routes are 404', async () => {
    const res = await handlerFor()(get('/nope'))
    expect(res.status).toBe(404)
  })
})
