import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { createMerchantAuth } from '@b2b-saas-starter/auth'
import { createDb } from '@b2b-saas-starter/db/client'
import { session as authSession } from '@b2b-saas-starter/db/schema'
import { createMerchantAuthHandler } from './merchant-auth-handler.ts'
import { resolveMerchantAuthConfig } from './merchant-auth-config.ts'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'

const origin = 'https://app.merchant.test'
const password = 'correct-horse-battery-staple'

describe('Merchant Owner Better Auth lifecycle', () => {
  let testD1: TestD1
  let auth: ReturnType<typeof createMerchantAuth>
  let verificationLinks: string[]
  let resetLinks: string[]

  beforeAll(async () => {
    testD1 = await provisionTestD1()
  })

  afterAll(async () => {
    await testD1.dispose()
  })

  beforeEach(() => {
    verificationLinks = []
    resetLinks = []
    auth = createMerchantAuth({
      db: createDb(testD1.d1),
      secret: 'merchant-auth-test-secret-that-is-at-least-thirty-two-characters',
      baseURL: origin,
      trustedOrigins: [origin],
      production: true,
      sendVerificationEmail: async ({ url }) => {
        verificationLinks.push(url)
      },
      sendResetPassword: async ({ url }) => {
        resetLinks.push(url)
      }
    })
  })

  const call = (path: string, body: object, cookie?: string) =>
    auth.handler(
      new Request(`${origin}/api/auth${path}`, {
        method: 'POST',
        headers: {
          origin,
          'content-type': 'application/json',
          ...(cookie ? { cookie } : {})
        },
        body: JSON.stringify(body)
      })
    )

  it('requires verification before issuing its host-only secure Merchant session cookie', async () => {
    const email = `owner-${crypto.randomUUID()}@merchant.test`
    const signUp = await call('/sign-up/email', {
      name: 'Merchant Owner',
      email,
      password,
      callbackURL: `${origin}/verify-email`
    })

    expect(signUp.status).toBe(200)
    expect(verificationLinks).toHaveLength(1)

    const beforeVerification = await call('/sign-in/email', { email, password })
    expect(beforeVerification.status).toBeGreaterThanOrEqual(400)

    const verified = await auth.handler(new Request(verificationLinks[0]!))
    expect(verified.status).toBeLessThan(400)

    const signIn = await call('/sign-in/email', { email, password })
    expect(signIn.status).toBe(200)
    const cookie = signIn.headers.get('set-cookie') ?? ''
    expect(cookie).toContain('merchant.session_token=')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).not.toMatch(/Domain=/i)
  })

  it('accepts the request origin when the development server is opened over the LAN', async () => {
    const lanOrigin = 'http://192.168.0.157:3072'
    const developmentConfig = resolveMerchantAuthConfig({}, false)
    const links: string[] = []
    auth = createMerchantAuth({
      db: createDb(testD1.d1),
      ...developmentConfig,
      production: false,
      sendVerificationEmail: async ({ url }) => {
        links.push(url)
      },
      sendResetPassword: async () => undefined
    })

    const response = await auth.handler(
      new Request(`${lanOrigin}/api/auth/sign-up/email`, {
        method: 'POST',
        headers: {
          origin: lanOrigin,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          name: 'LAN Merchant Owner',
          email: `lan-${crypto.randomUUID()}@merchant.test`,
          password,
          callbackURL: `${lanOrigin}/verify-email`
        })
      })
    )

    expect(response.status).toBe(200)
    expect(links).toHaveLength(1)
    expect(new URL(links[0]!).origin).toBe(lanOrigin)
  })

  it('keeps verified sign-in available when production email delivery is unavailable', async () => {
    const email = `delivery-outage-${crypto.randomUUID()}@merchant.test`
    await call('/sign-up/email', {
      name: 'Delivery Outage Owner',
      email,
      password,
      callbackURL: `${origin}/verify-email`
    })
    await auth.handler(new Request(verificationLinks[0]!))

    const handler = createMerchantAuthHandler({
      auth: {
        handler: auth.handler,
        getSession: (headers) => auth.api.getSession({ headers })
      },
      emailDelivery: { isConfigured: false },
      environment: 'production',
      rateLimiter: { take: async () => true }
    })
    const response = await handler(
      new Request(`${origin}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify({ email, password })
      })
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('set-cookie')).toContain('merchant.session_token=')
  })

  it('returns an indistinguishable recovery response and revokes every existing session on reset', async () => {
    const email = `recovery-${crypto.randomUUID()}@merchant.test`
    await call('/sign-up/email', {
      name: 'Recovery Owner',
      email,
      password,
      callbackURL: `${origin}/verify-email`
    })
    await auth.handler(new Request(verificationLinks[0]!))

    const firstSignIn = await call('/sign-in/email', { email, password })
    const secondSignIn = await call('/sign-in/email', { email, password })
    const firstCookie = (firstSignIn.headers.get('set-cookie') ?? '').split(';')[0]!
    const secondCookie = (secondSignIn.headers.get('set-cookie') ?? '').split(';')[0]!

    const known = await call('/request-password-reset', {
      email,
      redirectTo: `${origin}/reset-password`
    })
    const unknown = await call('/request-password-reset', {
      email: `unknown-${crypto.randomUUID()}@merchant.test`,
      redirectTo: `${origin}/reset-password`
    })
    expect(await known.json()).toEqual(await unknown.json())
    expect(resetLinks).toHaveLength(1)

    const token = new URL(resetLinks[0]!).pathname.split('/').at(-1)!
    const reset = await call('/reset-password', {
      token,
      newPassword: `${password}-new`
    })
    expect(reset.status).toBe(200)

    const firstSession = await auth.handler(
      new Request(`${origin}/api/auth/get-session`, {
        headers: { cookie: firstCookie }
      })
    )
    const secondSession = await auth.handler(
      new Request(`${origin}/api/auth/get-session`, {
        headers: { cookie: secondCookie }
      })
    )
    expect(await firstSession.json()).toBeNull()
    expect(await secondSession.json()).toBeNull()
  })

  it('revokes the current session on sign-out', async () => {
    const email = `sign-out-${crypto.randomUUID()}@merchant.test`
    await call('/sign-up/email', {
      name: 'Sign Out Owner',
      email,
      password,
      callbackURL: `${origin}/verify-email`
    })
    await auth.handler(new Request(verificationLinks[0]!))
    const signIn = await call('/sign-in/email', { email, password })
    const cookie = (signIn.headers.get('set-cookie') ?? '').split(';')[0]!

    const signOut = await call('/sign-out', {}, cookie)
    expect(signOut.status).toBe(200)

    const session = await auth.handler(
      new Request(`${origin}/api/auth/get-session`, { headers: { cookie } })
    )
    expect(await session.json()).toBeNull()
  })

  it('does not disclose whether a Merchant Owner account exists during sign-in', async () => {
    const email = `enumeration-${crypto.randomUUID()}@merchant.test`
    await call('/sign-up/email', {
      name: 'Enumeration Owner',
      email,
      password,
      callbackURL: `${origin}/verify-email`
    })
    await auth.handler(new Request(verificationLinks[0]!))

    const known = await call('/sign-in/email', {
      email,
      password: 'incorrect-password'
    })
    const unknown = await call('/sign-in/email', {
      email: `unknown-${crypto.randomUUID()}@merchant.test`,
      password: 'incorrect-password'
    })
    expect(known.status).toBe(unknown.status)
    expect(await known.json()).toEqual(await unknown.json())
  })

  it('requires a password reauthentication within fifteen minutes for email and password changes', async () => {
    const email = `sensitive-${crypto.randomUUID()}@merchant.test`
    await call('/sign-up/email', {
      name: 'Sensitive Owner',
      email,
      password,
      callbackURL: `${origin}/verify-email`
    })
    await auth.handler(new Request(verificationLinks[0]!))
    const signIn = await call('/sign-in/email', { email, password })
    const cookie = (signIn.headers.get('set-cookie') ?? '').split(';')[0]!
    const activeSession = await auth.api.getSession({
      headers: new Headers({ cookie })
    })
    expect(activeSession).not.toBeNull()
    await createDb(testD1.d1)
      .update(authSession)
      .set({ createdAt: new Date(Date.now() - 60 * 16 * 1_000) })
      .where(eq(authSession.id, activeSession!.session.id))

    const merchantHandler = createMerchantAuthHandler({
      auth: {
        handler: auth.handler,
        getSession: (headers) => auth.api.getSession({ headers })
      },
      emailDelivery: { isConfigured: true },
      environment: 'test',
      rateLimiter: { take: async () => true }
    })
    const passwordChange = await merchantHandler(
      new Request(`${origin}/api/auth/change-password`, {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json', cookie },
        body: JSON.stringify({
          currentPassword: password,
          newPassword: `${password}-changed`
        })
      })
    )
    const emailChange = await merchantHandler(
      new Request(`${origin}/api/auth/change-email`, {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json', cookie },
        body: JSON.stringify({
          newEmail: `changed-${crypto.randomUUID()}@merchant.test`
        })
      })
    )
    expect(passwordChange.status).toBe(403)
    expect(emailChange.status).toBe(403)
  })
})
