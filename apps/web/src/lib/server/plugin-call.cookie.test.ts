import { describe, expect, it, vi } from 'vite-plus/test'
import { Effect } from 'effect'
import { runRequest } from '../../start'
import { sessionCall } from './plugin-call'
import { webUserAdminBinding } from './user-admin-binding'
import { readSessionFromHeaders, readSessionForCookie } from './auth-session-read'

vi.mock('@b2b-saas-starter/auth', async () => {
  const { Context, Layer, ManagedRuntime } = await import('effect')
  const { fullApi, effectApi } = await import('effectful-better-auth')
  const { APIError } = await import('better-auth/api')
  async function endpoint(input: {
    headers: Headers
    returnHeaders?: boolean
    body?: { userId: string }
  }) {
    expect(input.returnHeaders).toBe(true)
    await Promise.resolve()
    const identity = input.body?.userId ?? input.headers.get('cookie')
    const headers = new Headers()
    headers.append(
      'set-cookie',
      `session=${identity}; Path=/; HttpOnly; Expires=Wed, 21 Oct 2037 07:28:00 GMT`
    )
    headers.append('set-cookie', 'admin_session=original; Path=/; HttpOnly')
    return { headers, response: { userId: identity } }
  }
  const raw = {
    getSession: async (input: Parameters<typeof endpoint>[0]) => {
      const response = { user: { id: 'user' }, session: { id: 'session' } }
      return input.returnHeaders
        ? {
            headers: new Headers({ 'set-cookie': 'session=refreshed; Path=/' }),
            response
          }
        : response
    },
    impersonateUser: endpoint,
    stopImpersonating: async (input: Parameters<typeof endpoint>[0]) => {
      const result = await endpoint(input)
      result.headers.set('set-cookie', 'session=original; Path=/; HttpOnly')
      result.headers.append('set-cookie', 'admin_session=; Path=/; Max-Age=0')
      return result
    },
    banUser: async () => {
      throw new APIError(
        'FORBIDDEN',
        { code: 'REFUSED', message: 'private diagnostic' },
        new Headers({ 'set-cookie': 'session=; Path=/; Max-Age=0' })
      )
    }
  }
  const service = { api: effectApi(raw), full: fullApi(raw) }
  const Tag = Context.Service<typeof service>('cookie-test-auth')
  const runtime = ManagedRuntime.make(Layer.succeed(Tag, service))
  return { Auth: { Tag }, cookieTestRuntime: runtime }
})

vi.mock('../auth-runtime', async () => {
  const { cookieTestRuntime } = await vi.importMock<{ cookieTestRuntime: object }>(
    '@b2b-saas-starter/auth'
  )
  return { authAvailability: () => ({ available: true, runtime: cookieTestRuntime }) }
})
vi.mock('./env-gate', () => ({ enforceRequiredEnvOnce: async () => {} }))
vi.mock('./i18n-middleware', () => ({
  localizeRequest: (_request: Request, next: () => Promise<Response>) => next()
}))
vi.mock('../observability', () => ({
  memoizePerRequest: (_key: string, read: () => Promise<object>) => read(),
  runWebRequestScope: (_scope: { request: Request }, next: () => Promise<Response>) =>
    next(),
  withWebRequestScope: (_scope: { event: string }, effect: Effect.Effect<Response>) =>
    Effect.scoped(effect),
  webRuntime: { runPromise: Effect.runPromise }
}))

function request(cookie: string) {
  return new Request('https://app.test/api/web/action', { headers: { cookie } })
}

describe('native auth cookie response transport', () => {
  it('propagates own-session rotation but not minted-credential inspection', async () => {
    const rotated = await runRequest(request('old'), async () => {
      await readSessionFromHeaders(new Headers({ cookie: 'old' }))
      return new Response(null)
    })
    expect(rotated.headers.getSetCookie()).toEqual(['session=refreshed; Path=/'])
    const inspected = await runRequest(request('old'), async () => {
      await readSessionForCookie('minted')
      return new Response(null)
    })
    expect(inspected.headers.getSetCookie()).toEqual([])
  })

  it('restores the outer outgoing scope after a nested request', async () => {
    const outer = await runRequest(request('outer'), async () => {
      await webUserAdminBinding.impersonateUser({ userId: 'outer' })
      const inner = await runRequest(request('inner'), async () => {
        await webUserAdminBinding.impersonateUser({ userId: 'inner' })
        return new Response(null)
      })
      expect(inner.headers.getSetCookie()[0]).toContain('session=inner;')
      return new Response(null)
    })
    expect(outer.headers.getSetCookie()).toHaveLength(2)
    expect(outer.headers.getSetCookie()[0]).toContain('session=outer;')
  })

  it('carries separate impersonation start cookies through the actual request pipeline', async () => {
    const response = await runRequest(request('admin'), async () => {
      await webUserAdminBinding.impersonateUser({ userId: 'target' })
      return Response.json({ ok: true })
    })
    expect(response.headers.getSetCookie()).toEqual([
      'session=target; Path=/; HttpOnly; Expires=Wed, 21 Oct 2037 07:28:00 GMT',
      'admin_session=original; Path=/; HttpOnly'
    ])
    await expect(response.json()).resolves.toEqual({ ok: true })
  })

  it('restores the admin cookie and expires the impersonation cookie on stop', async () => {
    const response = await runRequest(request('target'), async () => {
      await webUserAdminBinding.stopImpersonating()
      throw new Response(null, { status: 302, headers: { location: '/admin' } })
    })
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('/admin')
    expect(response.headers.getSetCookie()).toEqual([
      'session=original; Path=/; HttpOnly',
      'admin_session=; Path=/; Max-Age=0'
    ])
  })

  it('isolates concurrent request cookies and unwraps full API data', async () => {
    const results = await Promise.all(
      ['first', 'second'].map((identity) =>
        runRequest(request(identity), async () => {
          const data = await sessionCall((api) =>
            api.impersonateUser({ body: { userId: identity } })
          )
          return Response.json(data)
        })
      )
    )
    for (const [index, response] of results.entries()) {
      const identity = index === 0 ? 'first' : 'second'
      expect(response.headers.getSetCookie()[0]).toContain(`session=${identity};`)
      await expect(response.json()).resolves.toEqual({ userId: identity })
    }
  })

  it('preserves typed rejection and its deletion cookie', async () => {
    const response = await runRequest(request('admin'), async () => {
      await expect(
        sessionCall((api) => api.banUser({ body: { userId: 'target' } }))
      ).rejects.toMatchObject({ statusCode: 403, code: 'REFUSED' })
      return Response.json({ error: 'forbidden' }, { status: 403 })
    })
    expect(response.headers.getSetCookie()).toEqual(['session=; Path=/; Max-Age=0'])
    expect(response.status).toBe(403)
  })

  it('keeps issued cookies on a subsequent sanitized failure', async () => {
    const response = await runRequest(request('admin'), async () => {
      await webUserAdminBinding.impersonateUser({ userId: 'target' })
      throw new Error('private diagnostic')
    })
    expect(response.status).toBe(503)
    expect(response.headers.getSetCookie()).toHaveLength(2)
    expect(await response.text()).not.toContain('private diagnostic')
  })

  it('returns direct auth responses untouched when no cookies are pending', async () => {
    const headers = new Headers()
    headers.append('set-cookie', 'session=direct; Path=/')
    headers.append('set-cookie', 'state=; Max-Age=0')
    const direct = new Response(null, { status: 302, headers })
    expect(await runRequest(request('admin'), async () => direct)).toBe(direct)
    expect(direct.headers.getSetCookie()).toEqual([
      'session=direct; Path=/',
      'state=; Max-Age=0'
    ])
  })

  it('keeps direct handler cookies after earlier operation cookies', async () => {
    const response = await runRequest(request('admin'), async () => {
      await webUserAdminBinding.impersonateUser({ userId: 'target' })
      return new Response(null, { headers: { 'set-cookie': 'session=direct; Path=/' } })
    })
    expect(response.headers.getSetCookie()).toHaveLength(3)
    expect(response.headers.getSetCookie().at(-1)).toBe('session=direct; Path=/')
  })
})
