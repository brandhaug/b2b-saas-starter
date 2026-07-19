import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '@b2b-saas-starter/db/client'
import { session, user } from '@b2b-saas-starter/db/schema'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import { eq } from 'drizzle-orm'
import { Effect } from 'effect'
import {
  OperationsAuthorization,
  makeOperationsAuthorizationLayer
} from '@b2b-saas-starter/capabilities/operations'
import {
  createOperationsAuth,
  createOperationsAuthHandler,
  hasOperatorPermission,
  operatorRoles,
  provisionLocalOperator,
  readOperatorSessionReference,
  type OperationsAuth
} from './operations.ts'
import { createMerchantAuth } from './index.ts'

const origin = 'http://operations.localhost:3076'
const secret = 'operations-test-secret-that-is-at-least-thirty-two-bytes'
const password = 'local-operator-password'
const totpSecret = 'JBSWY3DPEHPK3PXP'

const cookieFor = (response: Response, name: string): string => {
  const cookies = response.headers.getSetCookie()
  const value = cookies.find((cookie) => cookie.startsWith(`${name}=`))
  return value?.split(';')[0] ?? ''
}

const resolveOperatorSession = async (input: {
  readonly auth: OperationsAuth
  readonly db: ReturnType<typeof createDb>
  readonly headers: Headers
  readonly now?: Date
}) => {
  const reference = await readOperatorSessionReference(input)
  if (!reference) return null
  return Effect.runPromise(
    Effect.gen(function* () {
      const authorization = yield* OperationsAuthorization
      return yield* authorization.authorize(reference, input.now)
    }).pipe(Effect.provide(makeOperationsAuthorizationLayer(input.db)))
  ).catch(() => null)
}

describe('Operations authentication contract', () => {
  let testD1: TestD1

  beforeAll(async () => {
    testD1 = await provisionTestD1()
  }, 30_000)

  afterAll(async () => {
    await testD1?.dispose()
  })

  const setup = async () => {
    const db = createDb(testD1.d1)
    const auth = createOperationsAuth({
      db,
      secret,
      baseURL: origin,
      trustedOrigins: [origin],
      production: false
    })
    const authHandler = createOperationsAuthHandler({ auth, db })
    const email = `operator-${crypto.randomUUID()}@operations.local`
    await provisionLocalOperator({
      db,
      secret,
      mode: 'development',
      operator: {
        id: `opr_${crypto.randomUUID()}`,
        name: 'Local System Operator',
        email,
        password,
        totpSecret,
        roles: ['merchant-impersonator', 'impersonation-auditor', 'operator-manager']
      }
    })
    const call = (path: string, body: object, cookie?: string) =>
      authHandler(
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
    const authenticate = async () => {
      const passwordResponse = await call('/sign-in/email', { email, password })
      const challengeCookie = cookieFor(passwordResponse, 'operations.two_factor')
      const { code } = await auth.api.generateTOTP({ body: { secret: totpSecret } })
      const totpResponse = await call(
        '/two-factor/verify-totp',
        { code, trustDevice: false },
        challengeCookie
      )
      return cookieFor(totpResponse, 'operations.session_token')
    }
    return { auth, authHandler, db, email, call, authenticate }
  }

  it('defines only the accepted composable Operator permissions', () => {
    expect(
      operatorRoles['merchant-reader'].authorize({ merchant: ['read'] }).success
    ).toBe(true)
    expect(
      operatorRoles['merchant-impersonator'].authorize({
        merchant: ['read', 'impersonate']
      }).success
    ).toBe(true)
    expect(
      operatorRoles['impersonation-auditor'].authorize({
        'impersonation-audit': ['read']
      }).success
    ).toBe(true)
    expect(
      operatorRoles['operator-manager'].authorize({ operator: ['manage'] }).success
    ).toBe(true)
    expect(
      operatorRoles['operator-manager'].authorize({ merchant: ['impersonate'] }).success
    ).toBe(false)
    expect(
      hasOperatorPermission(
        ['merchant-reader', 'impersonation-auditor'],
        'impersonation-audit:read'
      )
    ).toBe(true)
    expect(hasOperatorPermission(['merchant-reader'], 'merchant:impersonate')).toBe(
      false
    )
  })

  it('requires password plus TOTP before issuing an authoritative Operator Session', async () => {
    const fixture = await setup()
    const passwordResponse = await fixture.call('/sign-in/email', {
      email: fixture.email,
      password
    })
    expect(passwordResponse.status).toBe(200)
    expect(await passwordResponse.json()).toMatchObject({ twoFactorRedirect: true })
    const challengeCookie = cookieFor(passwordResponse, 'operations.two_factor')
    expect(challengeCookie).toContain('operations.two_factor')

    const { code } = await fixture.auth.api.generateTOTP({
      body: { secret: totpSecret }
    })
    const totpResponse = await fixture.call(
      '/two-factor/verify-totp',
      { code, trustDevice: false },
      challengeCookie
    )
    expect(totpResponse.status).toBe(200)
    const sessionCookie = cookieFor(totpResponse, 'operations.session_token')
    expect(sessionCookie).toMatch(/^operations\.session_token=/)

    const principal = await resolveOperatorSession({
      auth: fixture.auth,
      db: fixture.db,
      headers: new Headers({ cookie: sessionCookie })
    })
    expect(principal).toMatchObject({
      name: 'Local System Operator',
      roles: ['merchant-impersonator', 'impersonation-auditor', 'operator-manager']
    })
  })

  it('does not expose public signup or stock Better Auth administration', async () => {
    const fixture = await setup()
    for (const path of [
      '/sign-up/email',
      '/get-session',
      '/admin/create-user',
      '/admin/list-users',
      '/admin/list-user-sessions',
      '/admin/impersonate-user'
    ]) {
      const response = await fixture.call(path, {})
      expect(response.status, path).toBe(404)
    }
  })

  it('replaces the previous session and caps idle activity at eight absolute hours', async () => {
    const fixture = await setup()
    const firstCookie = await fixture.authenticate()
    const first = await resolveOperatorSession({
      auth: fixture.auth,
      db: fixture.db,
      headers: new Headers({ cookie: firstCookie })
    })
    expect(first).not.toBeNull()

    const secondCookie = await fixture.authenticate()
    expect(
      await resolveOperatorSession({
        auth: fixture.auth,
        db: fixture.db,
        headers: new Headers({ cookie: firstCookie })
      })
    ).toBeNull()
    const second = await resolveOperatorSession({
      auth: fixture.auth,
      db: fixture.db,
      headers: new Headers({ cookie: secondCookie })
    })
    expect(second).not.toBeNull()

    expect(
      await resolveOperatorSession({
        auth: fixture.auth,
        db: fixture.db,
        headers: new Headers({ cookie: secondCookie }),
        now: new Date(second!.idleExpiresAt.getTime())
      })
    ).toBeNull()

    const nearAbsolute = new Date(second!.absoluteExpiresAt.getTime() - 5 * 60_000)
    await fixture.db
      .update(session)
      .set({ operatorIdleExpiresAt: second!.absoluteExpiresAt })
      .where(eq(session.id, second!.sessionId))
    const refreshed = await resolveOperatorSession({
      auth: fixture.auth,
      db: fixture.db,
      headers: new Headers({ cookie: secondCookie }),
      now: nearAbsolute
    })
    expect(refreshed?.idleExpiresAt).toEqual(second!.absoluteExpiresAt)
    expect(
      await resolveOperatorSession({
        auth: fixture.auth,
        db: fixture.db,
        headers: new Headers({ cookie: secondCookie }),
        now: second!.absoluteExpiresAt
      })
    ).toBeNull()
  })

  it('rejects non-operator identities and local deterministic credentials in production', async () => {
    const fixture = await setup()
    const [operator] = await fixture.db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, fixture.email))
      .limit(1)
    await fixture.db
      .update(user)
      .set({ identityClass: 'merchant_member' })
      .where(eq(user.id, operator!.id))
    expect(
      (await fixture.call('/sign-in/email', { email: fixture.email, password })).status
    ).toBe(401)

    await expect(
      provisionLocalOperator({
        db: fixture.db,
        secret,
        mode: 'production',
        operator: {
          id: 'opr_forbidden',
          name: 'Forbidden',
          email: 'forbidden@example.com',
          password,
          totpSecret,
          roles: ['merchant-reader']
        }
      })
    ).rejects.toThrow('local operator provisioning is disabled')
  })

  it('cannot turn the same System Operator credential into a Merchant Session', async () => {
    const fixture = await setup()
    const merchantOrigin = 'http://merchant.localhost:3072'
    const merchantAuth = createMerchantAuth({
      db: fixture.db,
      secret: 'merchant-test-secret-that-is-distinct-and-long-enough',
      baseURL: merchantOrigin,
      trustedOrigins: [merchantOrigin],
      production: false,
      sendVerificationEmail: async () => undefined,
      sendResetPassword: async () => undefined
    })
    const response = await merchantAuth.handler(
      new Request(`${merchantOrigin}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: { origin: merchantOrigin, 'content-type': 'application/json' },
        body: JSON.stringify({ email: fixture.email, password })
      })
    )
    expect(response.headers.getSetCookie().join(';')).not.toContain(
      'merchant.session_token='
    )
  })
})
