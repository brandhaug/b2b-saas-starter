import { Effect } from 'effect'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { withWebRequestScope } from '../observability'
import { runAuthRequestGuards } from './auth-request-guard'

const state = vi.hoisted(() => ({
  session: {
    user: { id: 'usr_actor', email: 'actor@example.com' },
    session: { id: 'ses_actor', impersonatedBy: null }
  },
  runtime: {
    runPromise: vi.fn()
  },
  strong: vi.fn(),
  suspension: vi.fn(),
  impersonation: vi.fn(),
  ssoRequired: vi.fn(),
  disabledSso: vi.fn()
}))

vi.mock('../auth-runtime', () => ({ authRuntime: state.runtime }))
vi.mock('./strong-authentication-http', () => ({
  strongAuthenticationHttpResponse: state.strong
}))
vi.mock('./auth-organization-suspension', () => ({
  isOrganizationProductAction: (exchange: { pathname: string }) =>
    exchange.pathname.includes('/organization/'),
  suspendedOrganizationResponse: state.suspension
}))
vi.mock('./impersonation-guard', () => ({
  impersonationForbiddenAction: () => null,
  impersonationGuardResponse: state.impersonation
}))
vi.mock('./sso-sign-in-gate', () => ({
  enforceSsoRequired: state.ssoRequired,
  refuseDisabledConnection: state.disabledSso
}))

function request(method: 'GET' | 'POST', pathname: string, body?: unknown) {
  const init: RequestInit = { method }
  if (body !== undefined) {
    init.body = JSON.stringify(body)
  }
  return new Request(`https://example.test${pathname}`, init)
}

function run(input: Request, handler: (request: Request) => Effect.Effect<Response>) {
  // oxlint-disable-next-line starter/no-run-promise-in-tests -- the test crosses the public Effect guard interface into a Promise assertion
  return Effect.runPromise(
    withWebRequestScope(
      { event: 'auth.request.test' },
      runAuthRequestGuards(
        input,
        {
          method: input.method,
          pathname: new URL(input.url).pathname
        },
        handler
      )
    )
  )
}

beforeEach(() => {
  state.runtime.runPromise.mockResolvedValue(state.session)
  state.strong.mockResolvedValue(null)
  state.suspension.mockResolvedValue(null)
  state.impersonation.mockReturnValue(Effect.succeed(null))
  state.ssoRequired.mockReturnValue(Effect.succeed(null))
  state.disabledSso.mockReturnValue(Effect.succeed(null))
})

describe('auth request guard interface', () => {
  it('refuses before the plugin continuation can perform a write', async () => {
    const refusal = new Response(
      JSON.stringify({ code: 'capability_route_required' }),
      {
        status: 403
      }
    )
    state.strong.mockResolvedValue(refusal)
    const plugin = vi.fn(() => Effect.succeed(new Response('plugin')))

    const result = await run(request('POST', '/api/auth/oauth2/consent'), plugin)

    expect(result.outcome).toBe('refused')
    expect(result.response).toBe(refusal)
    expect(plugin).not.toHaveBeenCalled()
  })

  it('loads one shared session and body clone for audited GET and POST exchanges', async () => {
    const getResult = await run(request('GET', '/api/auth/callback/github'), () =>
      Effect.succeed(new Response('ok'))
    )
    expect(getResult.outcome).toBe('allowed')
    expect(getResult.context).toMatchObject({
      actorUserId: 'usr_actor',
      actorEmail: 'actor@example.com'
    })
    expect(state.runtime.runPromise).toHaveBeenCalledOnce()

    state.runtime.runPromise.mockClear()
    const postRequest = request('POST', '/api/auth/sign-out', { userId: 'usr_actor' })
    const postResult = await run(postRequest, () => Effect.succeed(new Response('ok')))
    expect(postResult.outcome).toBe('allowed')
    if (postResult.context === undefined) {
      throw new Error('audited POST must return its shared context')
    }
    if (postResult.context.request === undefined) {
      throw new Error('audited POST must return its request clone')
    }
    await expect(postResult.context.request.json()).resolves.toEqual({
      userId: 'usr_actor'
    })
    expect(state.runtime.runPromise).toHaveBeenCalledOnce()
  })

  it('keeps allowed flows on the plugin continuation and does not read an unnecessary session', async () => {
    state.runtime.runPromise.mockClear()
    const plugin = vi.fn(() => Effect.succeed(new Response('plugin')))

    const result = await run(request('GET', '/api/auth/get-session'), plugin)

    expect(result).toMatchObject({ outcome: 'allowed', response: expect.any(Response) })
    expect(plugin).toHaveBeenCalledOnce()
    expect(state.runtime.runPromise).not.toHaveBeenCalled()
  })

  it('preserves guard ordering and stops before the plugin on suspension', async () => {
    const order: Array<string> = []
    state.strong.mockImplementation(async () => {
      order.push('strong-authentication')
      return null
    })
    const refusal = new Response(JSON.stringify({ code: 'workspace_suspended' }), {
      status: 403
    })
    state.suspension.mockImplementation(async () => {
      order.push('suspension')
      return refusal
    })
    const plugin = vi.fn(() => Effect.succeed(new Response('plugin')))

    const result = await run(request('POST', '/api/auth/organization/update'), plugin)

    expect(result).toMatchObject({ outcome: 'refused', response: refusal })
    expect(order).toEqual(['strong-authentication', 'suspension'])
    expect(plugin).not.toHaveBeenCalled()
  })

  it('does not turn a failed pre-handler session observation into an auth failure', async () => {
    state.runtime.runPromise.mockRejectedValue(new Error('session read failed'))
    const plugin = vi.fn(() => Effect.succeed(new Response('plugin')))

    const result = await run(request('POST', '/api/auth/sign-out'), plugin)

    expect(result.outcome).toBe('allowed')
    expect(plugin).toHaveBeenCalledOnce()
    expect(result.context).toBeUndefined()
  })
})
