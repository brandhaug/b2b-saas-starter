import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vite-plus/test'

/**
 * What the two SSO halves do when the resolution itself fails. They disagree
 * on purpose (see the module docblock), and the difference is worth its own
 * file: the Seed-layer suite next door resolves for real, so the only way to
 * drive an unavailable capability is to replace the runtime boundary.
 */
vi.mock('../capabilities', () => ({
  runCapabilities: () => Promise.reject(new Error('the capability is unavailable'))
}))

import { enforceSsoRequired, refuseDisabledConnection } from './sso-sign-in-gate'

/** The gates are Effects; the assertions are promise ones. */
function run(gate: Effect.Effect<Response | null>): Promise<Response | null> {
  // oxlint-disable-next-line starter/no-run-promise-in-tests -- the deliberate promise boundary the auth catchall itself crosses
  return Effect.runPromise(gate)
}

function signInRequest(pathname: string, body: unknown): Request {
  return new Request(`http://localhost:3071/api/auth${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
}

describe('an unavailable SSO resolution', () => {
  it('fails open for the credential sign-in: a failed ask never refuses a password', async () => {
    const response = await run(
      enforceSsoRequired(
        signInRequest('/sign-in/email', { email: 'someone@acme.test' }),
        { method: 'POST', pathname: '/api/auth/sign-in/email' }
      )
    )

    expect(response).toBeNull()
  })

  it('fails closed for the SSO sign-in: an unreadable connection never starts the IdP flow', async () => {
    const response = await run(
      refuseDisabledConnection(
        signInRequest('/sign-in/sso', { email: 'someone@acme.test' }),
        { method: 'POST', pathname: '/api/auth/sign-in/sso' }
      )
    )

    expect(response?.status).toBe(503)
    await expect(response?.json()).resolves.toMatchObject({
      code: 'sso_connection_unavailable'
    })
  })
})
