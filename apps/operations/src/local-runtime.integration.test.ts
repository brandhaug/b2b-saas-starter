import { describe, expect, it } from 'vitest'
import { createOperationsAuth } from '@b2b-saas-starter/auth/operations'
import { createDb } from '@b2b-saas-starter/db/client'
import { createOperationsWorker, localOperatorFixture } from './index.ts'
import { env } from './lib/cloudflare-workers-shim-dev.ts'

const origin = 'http://localhost:3076'

describe('Operations local TanStack runtime', () => {
  it('redirects an anonymous authoritative session read to sign-in', async () => {
    const response = await createOperationsWorker().fetch(
      new Request(`${origin}/api/operations/session`, {
        headers: { accept: 'application/json' },
        redirect: 'manual'
      }),
      env
    )

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/sign-in')
  })

  it('authenticates and signs out through the persisted development binding', async () => {
    const form = new FormData()
    form.set('email', localOperatorFixture.email)
    form.set('password', localOperatorFixture.password)

    const passwordResponse = await createOperationsWorker().fetch(
      new Request(`${origin}/sign-in`, {
        method: 'POST',
        body: form,
        redirect: 'manual'
      }),
      env
    )

    expect(passwordResponse.status).toBe(303)
    expect(passwordResponse.headers.get('location')).toBe('/verify-totp')
    const challengeCookie = cookieFor(passwordResponse, 'operations.two_factor')

    const auth = createOperationsAuth({
      db: createDb(env.DB),
      secret: env.OPERATIONS_AUTH_SECRET,
      baseURL: origin,
      trustedOrigins: [origin],
      production: false,
      securityContact: env.OPERATIONS_SECURITY_CONTACT
    })
    const { code } = await auth.api.generateTOTP({
      body: { secret: localOperatorFixture.totpSecret }
    })
    const verificationForm = new FormData()
    verificationForm.set('code', code)
    const verificationResponse = await createOperationsWorker().fetch(
      new Request(`${origin}/verify-totp`, {
        method: 'POST',
        body: verificationForm,
        headers: { cookie: challengeCookie },
        redirect: 'manual'
      }),
      env
    )
    const sessionCookie = cookieFor(verificationResponse, 'operations.session_token')
    expect(verificationResponse.headers.get('location')).toBe('/')

    const signOutResponse = await createOperationsWorker().fetch(
      new Request(`${origin}/api/auth/sign-out`, {
        method: 'POST',
        headers: { cookie: sessionCookie, origin }
      }),
      env
    )
    expect(signOutResponse.ok).toBe(true)
    expect(signOutResponse.headers.getSetCookie().join(';')).toContain(
      'operations.session_token='
    )

    const protectedResponse = await createOperationsWorker().fetch(
      new Request(`${origin}/api/operations/session`, {
        headers: { cookie: sessionCookie },
        redirect: 'manual'
      }),
      env
    )
    expect(protectedResponse.status).toBe(303)
    expect(protectedResponse.headers.get('location')).toBe('/sign-in')
  })
})

const cookieFor = (response: Response, name: string): string => {
  const cookie = response.headers
    .getSetCookie()
    .find((value) => value.startsWith(`${name}=`))
  if (!cookie) throw new Error(`Missing ${name} cookie`)
  return cookie.split(';', 1)[0]!
}
