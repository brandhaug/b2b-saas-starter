import { Effect, Option } from 'effect'
import { describe, expect, it } from '@effect/vitest'
import {
  disabledConnectionResponse,
  refuseDisabledConnection
} from './sso-sign-in-gate'

function gate(path: string, body: unknown) {
  return refuseDisabledConnection(
    new Request(`http://localhost/api/auth${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    }),
    { method: 'POST', pathname: `/api/auth${path}` }
  )
}

describe('issue 287: account login and SSO discovery', () => {
  it('fails closed when connection resolution is unavailable', () => {
    expect(disabledConnectionResponse(null)?.status).toBe(503)
    expect(disabledConnectionResponse(Option.none())?.status).toBe(403)
  })

  it.effect('refuses a direct SSO request for a disabled provider', () =>
    Effect.gen(function* () {
      const response = yield* gate('/sign-in/sso', { providerId: 'sso_example_oidc' })
      expect(response?.status).toBe(403)
    })
  )

  it.effect('refuses an unknown domain and a workspace-slug selector', () =>
    Effect.gen(function* () {
      expect(
        (yield* gate('/sign-in/sso', { email: 'someone@unknown.example' }))?.status
      ).toBe(403)
      expect(
        (yield* gate('/sign-in/sso', { organizationSlug: 'starter-lab' }))?.status
      ).toBe(400)
    })
  )

  it.effect(
    'preserves account login through alternate methods for unrelated workspaces',
    () =>
      Effect.gen(function* () {
        for (const path of [
          '/sign-in/email',
          '/sign-in/username',
          '/sign-in/magic-link',
          '/sign-in/email-otp',
          '/sign-in/passkey',
          '/sign-in/social'
        ]) {
          expect(yield* gate(path, { email: 'someone@acme-corp.example' })).toBeNull()
        }
      })
  )
})
