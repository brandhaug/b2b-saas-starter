import { describe, expect, test } from 'vitest'
import type { ApiEnv } from './env.ts'
import { buildWebHandler } from './http.ts'

// Seed mode (no DB binding): in-memory capabilities, and the seed
// ApiTokenRegistry.verifyBearerToken accepts any token, so a present bearer
// header is enough to pass the scope gate.
const handlerFor = (env: ApiEnv = {}) => buildWebHandler(env).handler

const bearer = { authorization: 'Bearer bsk_test_token' }

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
    expect(doc.paths?.['/health']).toBeDefined()
  })

  test('GET /reference serves the Scalar UI', async () => {
    const res = await handlerFor()(get('/reference'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
  })

  test('GET /mcp returns the discovery document', async () => {
    const res = await handlerFor()(get('/mcp'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { name: string }
    expect(body.name).toBe('b2b-saas-starter-mcp')
  })

  test('GET workspace overview (authorized, known slug) returns the DTO', async () => {
    const res = await handlerFor()(get('/workspaces/starter-lab/overview', bearer))
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      workspace: { slug: string }
      modules: unknown[]
    }
    expect(body.workspace.slug).toBe('starter-lab')
    expect(Array.isArray(body.modules)).toBe(true)
  })

  test('GET workspace overview without a bearer token is 401', async () => {
    const res = await handlerFor()(get('/workspaces/starter-lab/overview'))
    expect(res.status).toBe(401)
    expect(((await res.json()) as { _tag: string })._tag).toBe('Unauthorized')
  })

  test('GET workspace overview for an unknown slug is 404', async () => {
    const res = await handlerFor()(get('/workspaces/does-not-exist/overview', bearer))
    expect(res.status).toBe(404)
    expect(((await res.json()) as { _tag: string })._tag).toBe('WorkspaceNotFound')
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

  test('POST assistant answer returns a mock reply when unconfigured', async () => {
    const res = await handlerFor()(
      post('/assistant/answer', {
        workspaceSlug: 'starter-lab',
        question: 'What is this?'
      })
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      provider: string
      assistantConfigured: boolean
    }
    expect(body.provider).toBe('mock')
    expect(body.assistantConfigured).toBe(false)
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
