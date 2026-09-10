import { Effect, Schema } from 'effect'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { withWebRequestScope } from '../observability'
import { runAuthRequestGuards } from './auth-request-guard'

/**
 * The guard suite drives the REAL refusal modules — strong authentication,
 * the impersonation guard, both SSO halves — and mocks only the two
 * boundaries they cannot reach in a test: the Better Auth session read and
 * the capability runtime. Mocking the refusals themselves is what let the
 * classification and the refusal drift apart (an organization path
 * classified as one thing and refused by another), so they stay coupled here.
 */

const state = vi.hoisted(() => ({
  /** What the mocked session read answers: a session, nobody, or a failure. */
  session: { anonymous: false, impersonated: false, unavailable: false },
  evidence: {
    qualified: false,
    recent: false,
    recovering: false,
    hasFactors: false,
    passwordVerified: false
  },
  /** Whether a connection resolves at all, and the row it resolves to. */
  sso: {
    resolves: false,
    unavailable: false,
    saml: false,
    providerId: 'sso_test',
    workspaceId: 'wrk_test',
    domain: 'acme.test',
    enabled: true,
    requireSso: false
  }
}))

vi.mock('./auth-session-read', async () => {
  const effect = await import('effect')
  const { fixtureSession: session } = await import('@/test/fixture-session')
  return {
    sessionFromHeaders: () => {
      if (state.session.unavailable) {
        return effect.Effect.fail({
          _tag: 'SessionReadFailed',
          reason: 'the session read failed'
        })
      }
      if (state.session.anonymous) {
        return effect.Effect.succeed(null)
      }
      return effect.Effect.succeed(
        session({
          userId: 'usr_actor',
          email: 'actor@example.com',
          impersonatedBy: state.session.impersonated ? 'usr_admin' : null
        })
      )
    }
  }
})

vi.mock('../capabilities', async () => {
  const effect = await import('effect')
  const { StrongAuthentication: Authentication } =
    await import('@b2b-saas-starter/capabilities/governance/strong-authentication')
  const { SsoConnections: Connections } =
    await import('@b2b-saas-starter/capabilities/governance/workspace-sso-connections')
  /** The capability's protocol union, from the mutable flag the tests flip. */
  function signInProtocol(): 'oidc' | 'saml' {
    if (state.sso.saml) {
      return 'saml'
    }
    return 'oidc'
  }

  function signInTarget() {
    const sso = state.sso
    return {
      providerId: sso.providerId,
      protocol: signInProtocol(),
      workspaceId: sso.workspaceId,
      domain: sso.domain,
      enabled: sso.enabled,
      requireSso: sso.requireSso
    }
  }
  const layer = effect.Layer.mergeAll(
    effect.Layer.succeed(Authentication)({
      status: () => effect.Effect.succeed(state.evidence),
      require: () => effect.Effect.void,
      requireRecent: () => effect.Effect.void
    }),
    effect.Layer.succeed(Connections)({
      resolveSignInTarget: () => {
        if (state.sso.unavailable) {
          return effect.Effect.die('sso connections unavailable')
        }
        return effect.Effect.succeed(
          state.sso.resolves ? effect.Option.some(signInTarget()) : effect.Option.none()
        )
      },
      // The sign-in gate reads exactly one method; the rest of the
      // capability's surface belongs to the settings form, and a guard that
      // reached for it here would be a defect, not a refusal.
      resolveRouting: () => effect.Effect.die('the guards never route'),
      resolveProvider: () => effect.Effect.die('the guards never resolve a provider'),
      list: effect.Effect.die('the guards never list connections'),
      get: () => effect.Effect.die('the guards never read one connection'),
      describe: () => effect.Effect.die('the guards never describe a connection'),
      create: () => effect.Effect.die('the guards never create a connection'),
      update: () => effect.Effect.die('the guards never update a connection'),
      remove: () => effect.Effect.die('the guards never remove a connection')
    })
  )
  return {
    // This mock IS runCapabilities: the guards' Promise-returning runtime boundary.
    runCapabilities: (guarded: Effect.Effect<unknown, unknown, never>) =>
      effect.Effect.runPromise(effect.Effect.provide(guarded, layer))
  }
})

function request(method: 'GET' | 'POST', pathname: string, body?: unknown) {
  const init: RequestInit = { method }
  if (body !== undefined) {
    init.body = JSON.stringify(body)
  }
  return new Request(`https://example.test${pathname}`, init)
}

function run(input: Request, handler: (request: Request) => Effect.Effect<Response>) {
  const guarded = withWebRequestScope(
    { event: 'auth.request.test' },
    runAuthRequestGuards(
      input,
      { method: input.method, pathname: new URL(input.url).pathname },
      handler
    )
  )
  // oxlint-disable-next-line starter/no-run-promise-in-tests -- the test crosses the public Effect guard interface into a Promise assertion
  return Effect.runPromise(guarded)
}

function plugin() {
  return vi.fn(() => Effect.succeed(new Response('plugin')))
}

/** The refusal body, decoded at the test's own parse boundary. */
const RefusalBody = Schema.Struct({
  code: Schema.String,
  action: Schema.optional(Schema.String)
})
const decodeRefusal = Schema.decodeUnknownSync(RefusalBody)

async function refusalCode(response: Response): Promise<string> {
  return decodeRefusal(await response.json()).code
}

beforeEach(() => {
  Object.assign(state.session, {
    anonymous: false,
    impersonated: false,
    unavailable: false
  })
  Object.assign(state.sso, {
    resolves: false,
    unavailable: false,
    enabled: true,
    requireSso: false
  })
  Object.assign(state.evidence, {
    qualified: false,
    recent: false,
    recovering: false,
    hasFactors: false,
    passwordVerified: false
  })
})

describe('auth request guard interface', () => {
  it('refuses before the plugin continuation can perform a write', async () => {
    const handler = plugin()

    const result = await run(request('POST', '/api/auth/oauth2/consent'), handler)

    expect(result.outcome).toBe('refused')
    expect(result.response.status).toBe(403)
    await expect(refusalCode(result.response)).resolves.toBe(
      'capability_route_required'
    )
    expect(handler).not.toHaveBeenCalled()
  })

  it('refuses every organization-product path as a capability route, however strong the session', async () => {
    state.evidence.qualified = true
    state.evidence.recent = true
    const capabilityRoutes = [
      ['POST', '/api/auth/organization/update'],
      ['POST', '/api/auth/organization/update-member-role'],
      ['GET', '/api/auth/organization/get-full-organization'],
      ['POST', '/api/auth/organization/accept-invitation'],
      ['POST', '/api/auth/sso/register'],
      ['POST', '/api/auth/delete-user']
    ] satisfies ReadonlyArray<readonly ['GET' | 'POST', string]>
    for (const [method, path] of capabilityRoutes) {
      const handler = plugin()
      const result = await run(request(method, path), handler)
      expect(result.outcome).toBe('refused')
      await expect(refusalCode(result.response)).resolves.toBe(
        'capability_route_required'
      )
      expect(handler).not.toHaveBeenCalled()
    }
  })

  it('keeps the plugin-owned workspace entry points and SSO protocol hops reachable', async () => {
    const reachable = [
      ['POST', '/api/auth/organization/create'],
      ['GET', '/api/auth/organization/list'],
      ['POST', '/api/auth/organization/set-active'],
      ['GET', '/api/auth/organization/list-user-invitations'],
      ['GET', '/api/auth/sso/callback/acme'],
      ['GET', '/api/auth/sso/saml2/sp/metadata']
    ] satisfies ReadonlyArray<readonly ['GET' | 'POST', string]>
    for (const [method, path] of reachable) {
      const handler = plugin()
      const result = await run(request(method, path), handler)
      expect(result.outcome).toBe('allowed')
      expect(handler).toHaveBeenCalledOnce()
    }
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

    const postRequest = request('POST', '/api/auth/sign-out', { userId: 'usr_actor' })
    const postResult = await run(postRequest, () => Effect.succeed(new Response('ok')))
    expect(postResult.outcome).toBe('allowed')
    if (postResult.context?.request === undefined) {
      throw new Error('audited POST must return its shared context and request clone')
    }
    await expect(postResult.context.request.json()).resolves.toEqual({
      userId: 'usr_actor'
    })
  })

  it('keeps allowed flows on the plugin continuation and does not read an unnecessary session', async () => {
    // A read here would be a wasted round trip, and the mock proves it does
    // not happen: an unavailable read on a path that needs no session must
    // still be allowed.
    state.session.unavailable = true
    const handler = plugin()

    const result = await run(request('GET', '/api/auth/get-session'), handler)

    expect(result).toMatchObject({ outcome: 'allowed', response: expect.any(Response) })
    expect(handler).toHaveBeenCalledOnce()
  })

  it('refuses with 503 when the session read itself failed', async () => {
    state.session.unavailable = true
    const handler = plugin()

    const result = await run(request('POST', '/api/auth/change-password'), handler)

    expect(result.outcome).toBe('refused')
    expect(result.response.status).toBe(503)
    await expect(refusalCode(result.response)).resolves.toBe('session_unavailable')
    expect(handler).not.toHaveBeenCalled()
    // No audit context either: nothing is known about the actor.
    expect(result.context).toBeUndefined()
  })

  it('keeps public passkey protocol and management paths reachable while guarding sensitive changes', async () => {
    const publicPasskeyPaths = [
      ['POST', '/api/auth/passkey/verify-authentication'],
      ['GET', '/api/auth/passkey/generate-authenticate-options'],
      ['GET', '/api/auth/passkey/list-user-passkeys'],
      ['POST', '/api/auth/passkey/update-passkey']
    ] satisfies ReadonlyArray<readonly ['GET' | 'POST', string]>
    for (const [method, path] of publicPasskeyPaths) {
      const handler = plugin()
      const result = await run(request(method, path), handler)
      expect(result.outcome).toBe('allowed')
      expect(handler).toHaveBeenCalledOnce()
    }

    const sensitivePasskeyPaths = [
      ['GET', '/api/auth/passkey/generate-register-options'],
      ['POST', '/api/auth/passkey/generate-register-options'],
      ['POST', '/api/auth/passkey/verify-registration'],
      ['POST', '/api/auth/passkey/delete-passkey']
    ] satisfies ReadonlyArray<readonly ['GET' | 'POST', string]>
    for (const [method, path] of sensitivePasskeyPaths) {
      const handler = plugin()
      const result = await run(request(method, path), handler)
      expect(result.outcome).toBe('refused')
      await expect(refusalCode(result.response)).resolves.toBe(
        'strong_authentication_required'
      )
      expect(handler).not.toHaveBeenCalled()
    }
  })

  it('lets an anonymous request reach Better Auth for its own 401', async () => {
    state.session.anonymous = true
    const handler = plugin()

    const result = await run(request('POST', '/api/auth/change-password'), handler)

    expect(result.outcome).toBe('allowed')
    expect(handler).toHaveBeenCalledOnce()
  })

  it('stops an impersonated credential change before Better Auth, naming the action', async () => {
    // Even with proof an ordinary session would pass on: an impersonation is
    // refused for what it is, not for what it failed to prove.
    state.session.impersonated = true
    state.evidence.qualified = true
    state.evidence.recent = true
    const handler = plugin()

    const result = await run(request('POST', '/api/auth/change-password'), handler)

    expect(result.outcome).toBe('refused')
    await expect(result.response.json()).resolves.toEqual({
      code: 'forbidden_while_impersonating',
      action: 'change_password'
    })
    expect(handler).not.toHaveBeenCalled()
  })

  it('requires strong authentication for admin containment and waives only its recency', async () => {
    state.evidence.qualified = true
    const containment = await run(
      request('POST', '/api/auth/admin/revoke-user-sessions'),
      plugin()
    )
    expect(containment.outcome).toBe('allowed')

    const mutation = await run(request('POST', '/api/auth/admin/set-role'), plugin())
    expect(mutation.outcome).toBe('refused')

    state.evidence.qualified = false
    const unqualified = await run(
      request('POST', '/api/auth/admin/revoke-user-sessions'),
      plugin()
    )
    expect(unqualified.outcome).toBe('refused')
  })

  it('lets an impersonating operator leave the impersonation', async () => {
    // An impersonation session is never qualified, so the exit cannot demand it.
    state.session.impersonated = true
    const handler = plugin()

    const result = await run(
      request('POST', '/api/auth/admin/stop-impersonating'),
      handler
    )

    expect(result.outcome).toBe('allowed')
    expect(handler).toHaveBeenCalledOnce()
  })

  it('stops required-SSO credential sign-in before Better Auth', async () => {
    state.session.anonymous = true
    state.sso.resolves = true
    state.sso.requireSso = true
    const handler = plugin()

    const result = await run(
      request('POST', '/api/auth/sign-in/email', { email: 'someone@acme.test' }),
      handler
    )

    expect(result.outcome).toBe('refused')
    await expect(refusalCode(result.response)).resolves.toBe('sso_required')
    expect(handler).not.toHaveBeenCalled()
  })

  it('stops disabled-SSO sign-in before Better Auth', async () => {
    state.session.anonymous = true
    state.sso.resolves = true
    state.sso.enabled = false
    const handler = plugin()

    const result = await run(
      request('POST', '/api/auth/sign-in/sso', { email: 'someone@acme.test' }),
      handler
    )

    expect(result.outcome).toBe('refused')
    await expect(refusalCode(result.response)).resolves.toBe('sso_connection_disabled')
    expect(handler).not.toHaveBeenCalled()
  })
})
