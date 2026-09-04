import { Effect, Option, Schema } from 'effect'
import { describe, expect, it } from 'vite-plus/test'

import { type SsoSignInTarget } from '@b2b-saas-starter/capabilities/governance/workspace-sso-connections'

import {
  disabledConnectionResponse,
  enforceSsoRequired,
  isCredentialSignIn,
  isSsoSignIn,
  refuseDisabledConnection,
  ssoRequiredResponse
} from './sso-sign-in-gate'

/** The refusal body, decoded at the test's parse boundary. */
const RefusalBody = Schema.Struct({
  code: Schema.String,
  message: Schema.optional(Schema.String)
})
const decodeRefusal = Schema.decodeUnknownSync(RefusalBody)

/**
 * The decision cores are pure; the request-shaped wrappers run against the
 * app's default Seed layer (the test-mode shim leaves `DB` undefined), whose
 * one fixture connection is the **disabled** `sso_example_oidc` for
 * `acme-corp.example` — exactly the row the disabled-connection refusal
 * exists for.
 */

function target(overrides: Partial<SsoSignInTarget>): Option.Option<SsoSignInTarget> {
  return Option.some({
    providerId: 'sso_test',
    protocol: 'oidc',
    workspaceId: 'wrk_test',
    domain: 'acme.test',
    enabled: true,
    requireSso: false,
    ...overrides
  })
}

function gateRequest(pathname: string, body: unknown): Request {
  return new Request(`http://localhost:3071/api/auth${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
}

describe('path matchers', () => {
  it('matches the two sign-in paths and nothing else', () => {
    expect(
      isCredentialSignIn({ method: 'POST', pathname: '/api/auth/sign-in/email' })
    ).toBe(true)
    expect(
      isCredentialSignIn({ method: 'GET', pathname: '/api/auth/sign-in/email' })
    ).toBe(false)
    expect(
      isCredentialSignIn({ method: 'POST', pathname: '/api/auth/sign-in/sso' })
    ).toBe(false)
    expect(isSsoSignIn({ method: 'POST', pathname: '/api/auth/sign-in/sso' })).toBe(
      true
    )
    expect(isSsoSignIn({ method: 'POST', pathname: '/api/auth/callback/oidc' })).toBe(
      false
    )
  })
})

describe('ssoRequiredResponse (the credential half)', () => {
  it('refuses with the better-call error shape when the domain demands SSO', async () => {
    const response = ssoRequiredResponse(target({ requireSso: true }))
    expect(response?.status).toBe(403)
    expect(response?.headers.get('content-type')).toBe(
      'application/json; charset=utf-8'
    )
    expect(decodeRefusal(await response?.json())).toEqual({
      code: 'sso_required',
      message: 'This workspace requires single sign-on for your email domain.'
    })
  })

  it('lets an enabled connection that does not demand SSO through', () => {
    expect(ssoRequiredResponse(target({ requireSso: false }))).toBeNull()
  })

  it('lets a domain without a connection through', () => {
    expect(ssoRequiredResponse(Option.none())).toBeNull()
  })

  it('lets everything through when the resolution itself failed', () => {
    expect(ssoRequiredResponse(null)).toBeNull()
  })
})

describe('disabledConnectionResponse (the SSO half)', () => {
  it('refuses a disabled connection with the better-call error shape', async () => {
    const response = disabledConnectionResponse(target({ enabled: false }))
    expect(response?.status).toBe(403)
    const body = decodeRefusal(await response?.json())
    expect(body.code).toBe('sso_connection_disabled')
    expect(body.message).toContain('disabled')
  })

  it('lets an enabled connection through', () => {
    expect(disabledConnectionResponse(target({ enabled: true }))).toBeNull()
  })

  it('lets a domain without a connection, and a failed resolution, through', () => {
    expect(disabledConnectionResponse(Option.none())).toBeNull()
    expect(disabledConnectionResponse(null)).toBeNull()
  })
})

describe('the request wrappers against the Seed layer', () => {
  it('refuses a direct /sign-in/sso for the seeded disabled connection', async () => {
    const response = await Effect.runPromise(
      refuseDisabledConnection(
        gateRequest('/sign-in/sso', { email: 'someone@acme-corp.example' }),
        { method: 'POST', pathname: '/api/auth/sign-in/sso' }
      )
    )
    expect(response?.status).toBe(403)
    expect(decodeRefusal(await response?.json())).toMatchObject({
      code: 'sso_connection_disabled'
    })
  })

  it('refuses a providerId-addressed /sign-in/sso for the same row', async () => {
    const response = await Effect.runPromise(
      refuseDisabledConnection(
        gateRequest('/sign-in/sso', { providerId: 'sso_example_oidc' }),
        { method: 'POST', pathname: '/api/auth/sign-in/sso' }
      )
    )
    expect(response?.status).toBe(403)
  })

  it('lets /sign-in/sso through for a domain with no connection', async () => {
    const response = await Effect.runPromise(
      refuseDisabledConnection(
        gateRequest('/sign-in/sso', { email: 'demo@starter.local' }),
        { method: 'POST', pathname: '/api/auth/sign-in/sso' }
      )
    )
    expect(response).toBeNull()
  })

  it('lets the credential path through for the disabled connection — it does not demand SSO', async () => {
    const response = await Effect.runPromise(
      enforceSsoRequired(
        gateRequest('/sign-in/email', { email: 'someone@acme-corp.example' }),
        {
          method: 'POST',
          pathname: '/api/auth/sign-in/email'
        }
      )
    )
    expect(response).toBeNull()
  })

  it('ignores a non-JSON body instead of failing the sign-in', async () => {
    const request = new Request('http://localhost:3071/api/auth/sign-in/sso', {
      method: 'POST'
    })
    const response = await Effect.runPromise(
      refuseDisabledConnection(request, {
        method: 'POST',
        pathname: '/api/auth/sign-in/sso'
      })
    )
    expect(response).toBeNull()
  })
})
