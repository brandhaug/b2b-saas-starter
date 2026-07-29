import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '@b2b-saas-starter/db/client'
import {
  account,
  impersonationRecords,
  merchantMemberships,
  merchants,
  operationsAuditEvents,
  operationsNotificationIntents,
  operatorEnrollments,
  operatorInvitations,
  session,
  user
} from '@b2b-saas-starter/db/schema'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import { hashPassword } from 'better-auth/crypto'
import { eq } from 'drizzle-orm'
import { Effect } from 'effect'
import {
  OperationsAuthorization,
  makeOperationsAuthorizationLayer
} from '@b2b-saas-starter/capabilities/operations'
import {
  makeD1OperatorMaintenanceDatabase,
  makeSystemOperatorMaintenance
} from '@b2b-saas-starter/capabilities/operations'
import {
  createOperationsAuth,
  createOperationsAuthHandler,
  hasOperatorPermission,
  operatorPermissions,
  operatorRoleNames,
  operatorRoles,
  provisionLocalOperator,
  readOperatorSessionReference,
  verifyOperatorTotpPresence,
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
      production: false,
      securityContact: 'security@example.test'
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

    const expected = {
      'merchant-reader': ['merchant:read'],
      'merchant-impersonator': ['merchant:read', 'merchant:impersonate'],
      'impersonation-auditor': ['impersonation-audit:read'],
      'operator-manager': ['operator:manage'],
      'messaging-reader': ['messaging:read'],
      'messaging-controller': ['messaging:control'],
      'messaging-finance': ['messaging:finance'],
      'messaging-reconciler': ['messaging:reconcile'],
      'messaging-incident-responder': ['messaging:incident']
    } as const
    for (const role of operatorRoleNames) {
      for (const permission of operatorPermissions) {
        const [resource, action] = permission.split(':')
        const statement = { [resource!]: [action!] } as never
        const allowed = expected[role].includes(permission as never)
        expect(
          operatorRoles[role].authorize(statement).success,
          `${role} ${permission}`
        ).toBe(allowed)
        expect(hasOperatorPermission([role], permission), `${role} ${permission}`).toBe(
          allowed
        )
      }
    }

    for (const role of [
      'messaging-reader',
      'messaging-controller',
      'messaging-finance',
      'messaging-reconciler',
      'messaging-incident-responder'
    ] as const) {
      expect(hasOperatorPermission([role], 'merchant:impersonate'), role).toBe(false)
    }
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
    const [authoritative] = await fixture.db
      .select({ operatorTotpVerifiedAt: session.operatorTotpVerifiedAt })
      .from(session)
      .where(eq(session.id, principal!.sessionId))
    expect(authoritative?.operatorTotpVerifiedAt).toBeInstanceOf(Date)

    await fixture.db
      .update(session)
      .set({ operatorTotpVerifiedAt: null })
      .where(eq(session.id, principal!.sessionId))
    await expect(
      Effect.runPromise(
        verifyOperatorTotpPresence({
          auth: fixture.auth,
          db: fixture.db,
          secret,
          operatorId: principal!.id,
          operatorSessionId: principal!.sessionId,
          code: '000000'
        })
      )
    ).rejects.toMatchObject({
      _tag: 'OperatorTotpPresenceDenied',
      reason: 'operator TOTP challenge failed'
    })
    await Effect.runPromise(
      verifyOperatorTotpPresence({
        auth: fixture.auth,
        db: fixture.db,
        secret,
        operatorId: principal!.id,
        operatorSessionId: principal!.sessionId,
        code
      })
    )
    const [refreshedPresence] = await fixture.db
      .select({ operatorTotpVerifiedAt: session.operatorTotpVerifiedAt })
      .from(session)
      .where(eq(session.id, principal!.sessionId))
    expect(refreshedPresence?.operatorTotpVerifiedAt).toBeInstanceOf(Date)
  })

  it('does not expose public signup or stock Better Auth administration', async () => {
    const fixture = await setup()
    for (const path of [
      '/sign-up/email',
      '/get-session',
      '/admin/set-role',
      '/admin/get-user',
      '/admin/create-user',
      '/admin/update-user',
      '/admin/list-users',
      '/admin/list-user-sessions',
      '/admin/unban-user',
      '/admin/ban-user',
      '/admin/impersonate-user',
      '/admin/stop-impersonating',
      '/admin/revoke-user-session',
      '/admin/revoke-user-sessions',
      '/admin/remove-user',
      '/admin/set-user-password',
      '/admin/has-permission'
    ]) {
      const response = await fixture.call(path, {})
      expect(response.status, path).toBe(404)
    }
  })

  it('resumes incomplete enrollment without issuing a password-only Operator Session', async () => {
    const fixture = await setup()
    const suffix = crypto.randomUUID()
    const operatorId = `opr_incomplete_${suffix}`
    const incompleteEmail = `incomplete-${suffix}@operations.local`
    const invitationId = `oinv_${suffix}`
    const [manager] = await fixture.db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, fixture.email))
      .limit(1)
    await fixture.db.insert(user).values({
      id: operatorId,
      email: incompleteEmail,
      name: 'Incomplete Operator',
      emailVerified: true,
      twoFactorEnabled: false,
      identityClass: 'system_operator',
      role: 'merchant-reader',
      createdAt: new Date(),
      updatedAt: new Date()
    })
    await fixture.db.insert(account).values({
      id: `credential_${operatorId}`,
      accountId: operatorId,
      providerId: 'credential',
      userId: operatorId,
      password: await hashPassword(password),
      createdAt: new Date(),
      updatedAt: new Date()
    })
    await fixture.db.insert(operatorInvitations).values({
      id: invitationId,
      email: incompleteEmail,
      rolesJson: ['merchant-reader'],
      tokenHash: `invitation_hash_${suffix}`,
      invitedByOperatorId: manager!.id,
      acceptedOperatorId: operatorId,
      expiresAt: new Date(Date.now() + 24 * 60 * 60_000),
      acceptedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date()
    })
    await fixture.db.insert(operatorEnrollments).values({
      id: `oenr_${suffix}`,
      invitationId,
      operatorId,
      sessionTokenHash: `enrollment_hash_${suffix}`,
      sessionExpiresAt: new Date(Date.now() - 1_000),
      passwordSetAt: new Date(),
      emailVerifiedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date()
    })

    const response = await fixture.call('/sign-in/email', {
      email: incompleteEmail,
      password
    })
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      error: 'enrollment_required',
      operatorId
    })
    expect(response.headers.getSetCookie().join(';')).not.toContain(
      'operations.session_token='
    )
    for (const path of [
      '/two-factor/disable',
      '/two-factor/generate-backup-codes',
      '/change-password'
    ]) {
      expect((await fixture.call(path, {})).status, path).toBe(404)
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

    const suffix = crypto.randomUUID()
    const targetId = `mem_session_replacement_${suffix}`
    const merchantId = `mer_session_replacement_${suffix}`
    const merchantSessionId = `mss_session_replacement_${suffix}`
    const activeUntil = new Date(Date.now() + 60 * 60_000)
    await fixture.db.insert(user).values({
      id: targetId,
      email: `${targetId}@example.test`,
      name: 'Session replacement target',
      emailVerified: true,
      identityClass: 'merchant_member',
      createdAt: new Date(),
      updatedAt: new Date()
    })
    await fixture.db.insert(merchants).values({
      id: merchantId,
      publicName: 'Session Replacement Merchant',
      slug: `session-replacement-${suffix}`,
      timezone: 'Europe/Bucharest',
      currency: 'RON',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    })
    await fixture.db.insert(merchantMemberships).values({
      merchantId,
      userId: targetId,
      role: 'owner',
      createdAt: new Date().toISOString()
    })
    await fixture.db.insert(session).values({
      id: merchantSessionId,
      token: `merchant_token_${suffix}`,
      userId: targetId,
      impersonatedBy: first!.id,
      expiresAt: activeUntil,
      createdAt: new Date(),
      updatedAt: new Date()
    })
    await fixture.db.insert(impersonationRecords).values({
      id: `imp_session_replacement_${suffix}`,
      operatorId: first!.id,
      operatorSessionId: first!.sessionId,
      targetMemberId: targetId,
      merchantId,
      lifecycle: 'active',
      reason: 'Verify replacement revocation',
      ticketHash: `hash_${suffix}`,
      handoffExpiresAt: activeUntil,
      merchantSessionId,
      activeExpiresAt: activeUntil,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    })

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
    const [replaced] = await fixture.db
      .select()
      .from(impersonationRecords)
      .where(eq(impersonationRecords.merchantSessionId, merchantSessionId))
    expect(replaced).toMatchObject({
      lifecycle: 'revoked',
      terminationCause: 'operator-session-replaced'
    })
    const [revokedMerchantSession] = await fixture.db
      .select()
      .from(session)
      .where(eq(session.id, merchantSessionId))
    expect(revokedMerchantSession?.expiresAt).toEqual(replaced?.terminalAt)
    expect(
      await fixture.db
        .select()
        .from(operationsNotificationIntents)
        .where(eq(operationsNotificationIntents.impersonationId, replaced!.id))
    ).toHaveLength(1)
    expect(
      await fixture.db
        .select()
        .from(operationsAuditEvents)
        .where(eq(operationsAuditEvents.impersonationId, replaced!.id))
    ).toHaveLength(1)

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
  }, 15_000)

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

  it('denies password-only access and invalidates the old session after emergency recovery', async () => {
    const fixture = await setup()
    const sessionCookie = await fixture.authenticate()
    const principal = await resolveOperatorSession({
      auth: fixture.auth,
      db: fixture.db,
      headers: new Headers({ cookie: sessionCookie })
    })
    expect(principal).not.toBeNull()

    await Effect.runPromise(
      makeSystemOperatorMaintenance(makeD1OperatorMaintenanceDatabase(testD1.d1), {
        securityContact: 'security@example.test'
      }).recover({
        actor: 'security-maintainer@example.test',
        environment: 'local',
        remote: false,
        email: fixture.email,
        confirmedEmail: fixture.email
      })
    )

    expect(
      await resolveOperatorSession({
        auth: fixture.auth,
        db: fixture.db,
        headers: new Headers({ cookie: sessionCookie })
      })
    ).toBeNull()
    expect(
      (await fixture.call('/sign-in/email', { email: fixture.email, password })).status
    ).toBe(401)
  })
})
