import { Effect } from 'effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  adminAuditInput,
  authAuditInput,
  isAdminAuthExchange,
  isAuditedAuthExchange,
  needsPreHandlerActor,
  recordAuthAudit,
  type AuthAuditContext,
  type AuthAuditOutcome,
  type RunAuditCapabilities
} from './auth-audit'

/**
 * The capability runner `recordAuthAudit` writes through, handed in as its third
 * argument. Resolving means the audit row was written; rejecting is the D1
 * outage the "dropped" case asserts on.
 */
const runCapabilities = vi.fn<RunAuditCapabilities>()

/**
 * `recordAuthAudit` needs a Scope for its wide-event annotations — the auth
 * catchall supplies one via `withHttpRequestScope`, tests via `Effect.scoped`.
 */
function runRecordAuthAudit(
  request: Request,
  response: Response
): Promise<AuthAuditOutcome> {
  return Effect.runPromise(
    Effect.scoped(recordAuthAudit(request, response, runCapabilities))
  )
}

beforeEach(() => {
  runCapabilities.mockReset()
  runCapabilities.mockResolvedValue(undefined)
})

describe('isAuditedAuthExchange', () => {
  it('accepts the lifecycle POSTs and the verification GET', () => {
    expect(
      isAuditedAuthExchange({ method: 'POST', pathname: '/api/auth/sign-in/email' })
    ).toBe(true)
    expect(
      isAuditedAuthExchange({ method: 'POST', pathname: '/api/auth/sign-in/username' })
    ).toBe(true)
    expect(
      isAuditedAuthExchange({ method: 'POST', pathname: '/api/auth/sign-up/email' })
    ).toBe(true)
    expect(
      isAuditedAuthExchange({ method: 'POST', pathname: '/api/auth/sign-out' })
    ).toBe(true)
    expect(
      isAuditedAuthExchange({
        method: 'POST',
        pathname: '/api/auth/user/revoke-session'
      })
    ).toBe(true)
    expect(
      isAuditedAuthExchange({
        method: 'POST',
        pathname: '/api/auth/user/revoke-sessions'
      })
    ).toBe(true)
    expect(
      isAuditedAuthExchange({
        method: 'POST',
        pathname: '/api/auth/request-password-reset'
      })
    ).toBe(true)
    expect(
      isAuditedAuthExchange({ method: 'POST', pathname: '/api/auth/reset-password' })
    ).toBe(true)
    expect(
      isAuditedAuthExchange({ method: 'GET', pathname: '/api/auth/verify-email' })
    ).toBe(true)
  })

  it('rejects other auth traffic', () => {
    expect(
      isAuditedAuthExchange({ method: 'GET', pathname: '/api/auth/sign-in/email' })
    ).toBe(false)
    expect(
      isAuditedAuthExchange({ method: 'GET', pathname: '/api/auth/get-session' })
    ).toBe(false)
    // The reset token-exchange redirect validates without mutating.
    expect(
      isAuditedAuthExchange({
        method: 'GET',
        pathname: '/api/auth/reset-password/tok_reset'
      })
    ).toBe(false)
  })
})

describe('needsPreHandlerActor', () => {
  it('flags the session-ending rows and the admin mutations', () => {
    for (const pathname of [
      '/api/auth/sign-out',
      '/api/auth/user/revoke-session',
      '/api/auth/user/revoke-sessions',
      '/api/auth/admin/set-role'
    ]) {
      expect(needsPreHandlerActor({ method: 'POST', pathname })).toBe(true)
    }
  })

  it('leaves body-attributed exchanges to the response read', () => {
    expect(
      needsPreHandlerActor({ method: 'POST', pathname: '/api/auth/sign-in/email' })
    ).toBe(false)
    expect(
      needsPreHandlerActor({
        method: 'POST',
        pathname: '/api/auth/sign-in/username'
      })
    ).toBe(false)
  })
})

describe('authAuditInput', () => {
  it('maps a successful credential sign-in to an attributed audit event', () => {
    const input = authAuditInput({
      method: 'POST',
      pathname: '/api/auth/sign-in/email',
      status: 200,
      userId: 'usr_demo'
    })
    expect(input).toEqual({
      workspaceId: null,
      actorUserId: 'usr_demo',
      eventType: 'auth.sign_in',
      targetType: 'session',
      metadata: { method: 'email', statusCode: 200 }
    })
  })

  it('maps a rejected credential sign-in to an unattributed failure event', () => {
    const input = authAuditInput({
      method: 'POST',
      pathname: '/api/auth/sign-in/email',
      status: 401,
      userId: null
    })
    expect(input?.eventType).toBe('auth.sign_in_failed')
    expect(input?.actorUserId).toBeNull()
    expect(input?.metadata).toEqual({ method: 'email', statusCode: 401 })
  })

  it('never attributes an actor on failure, even if a user id is passed', () => {
    const input = authAuditInput({
      method: 'POST',
      pathname: '/api/auth/sign-in/email',
      status: 500,
      userId: 'usr_demo'
    })
    expect(input?.actorUserId).toBeNull()
  })

  it('maps a successful sign-up to an attributed event', () => {
    const input = authAuditInput({
      method: 'POST',
      pathname: '/api/auth/sign-up/email',
      status: 200,
      userId: 'usr_new'
    })
    expect(input?.eventType).toBe('auth.sign_up')
    expect(input?.actorUserId).toBe('usr_new')
    expect(input?.targetType).toBe('user')
  })

  it('maps a rejected sign-up (duplicate email) to an unattributed failure event', () => {
    const input = authAuditInput({
      method: 'POST',
      pathname: '/api/auth/sign-up/email',
      status: 422,
      userId: null
    })
    expect(input?.eventType).toBe('auth.sign_up_failed')
    expect(input?.actorUserId).toBeNull()
  })

  it('records exactly one event per password-reset request, unattributed', () => {
    // The endpoint answers identically whether the email exists — so does the
    // event: one unattributed row at 200, no success/failure pair.
    const known = authAuditInput({
      method: 'POST',
      pathname: '/api/auth/request-password-reset',
      status: 200,
      userId: null
    })
    expect(known).toEqual({
      workspaceId: null,
      actorUserId: null,
      eventType: 'auth.password_reset_requested',
      targetType: 'user',
      metadata: { statusCode: 200 }
    })
  })

  it('maps the reset itself to a success/failure pair', () => {
    const success = authAuditInput({
      method: 'POST',
      pathname: '/api/auth/reset-password',
      status: 200,
      userId: null
    })
    expect(success?.eventType).toBe('auth.password_reset')
    expect(success?.actorUserId).toBeNull()

    const failure = authAuditInput({
      method: 'POST',
      pathname: '/api/auth/reset-password',
      status: 400,
      userId: null
    })
    expect(failure?.eventType).toBe('auth.password_reset_failed')
  })

  it('reads email-verification outcome from the redirect Location', () => {
    // Success: 302 to the callback URL with no `error` param.
    const success = authAuditInput({
      method: 'GET',
      pathname: '/api/auth/verify-email',
      status: 302,
      userId: null,
      locationHeader: 'http://localhost:3071/verify-email'
    })
    expect(success?.eventType).toBe('auth.email_verified')

    // Failure: 302 with an `error` param appended.
    const failure = authAuditInput({
      method: 'GET',
      pathname: '/api/auth/verify-email',
      status: 302,
      userId: null,
      locationHeader: 'http://localhost:3071/verify-email?error=INVALID_TOKEN'
    })
    expect(failure?.eventType).toBe('auth.email_verification_failed')

    // A redirect without a Location header is not a success we can vouch for.
    const noLocation = authAuditInput({
      method: 'GET',
      pathname: '/api/auth/verify-email',
      status: 302,
      userId: null,
      locationHeader: null
    })
    expect(noLocation?.eventType).toBe('auth.email_verification_failed')
  })

  it('attributes a 200 verification response from its body', () => {
    const input = authAuditInput({
      method: 'GET',
      pathname: '/api/auth/verify-email',
      status: 200,
      userId: 'usr_demo'
    })
    expect(input?.eventType).toBe('auth.email_verified')
    expect(input?.actorUserId).toBe('usr_demo')
  })

  it('maps a username sign-in to the same event pair, method named', () => {
    const input = authAuditInput({
      method: 'POST',
      pathname: '/api/auth/sign-in/username',
      status: 200,
      userId: 'usr_demo'
    })
    expect(input?.eventType).toBe('auth.sign_in')
    expect(input?.actorUserId).toBe('usr_demo')
    expect(input?.targetType).toBe('session')
    expect(input?.metadata).toEqual({ method: 'username', statusCode: 200 })

    const failed = authAuditInput({
      method: 'POST',
      pathname: '/api/auth/sign-in/username',
      status: 401,
      userId: null
    })
    expect(failed?.eventType).toBe('auth.sign_in_failed')
  })

  it('maps a successful sign-out to an attributed event targeting the session', () => {
    const input = authAuditInput({
      method: 'POST',
      pathname: '/api/auth/sign-out',
      status: 200,
      userId: 'usr_demo'
    })
    expect(input?.eventType).toBe('auth.sign_out')
    expect(input?.actorUserId).toBe('usr_demo')
    expect(input?.targetType).toBe('session')
    expect(input?.metadata).toEqual({ statusCode: 200 })
  })

  it('keeps the pre-handler actor on a failed sign-out or revocation', () => {
    // The session was resolved before Better Auth judged the request — same
    // reasoning as the admin events.
    for (const pathname of [
      '/api/auth/sign-out',
      '/api/auth/user/revoke-session',
      '/api/auth/user/revoke-sessions'
    ]) {
      const input = authAuditInput({
        method: 'POST',
        pathname,
        status: 500,
        userId: 'usr_demo'
      })
      expect(input?.eventType).toBe(
        pathname.endsWith('/sign-out')
          ? 'auth.sign_out_failed'
          : 'auth.session_revocation_failed'
      )
      expect(input?.actorUserId).toBe('usr_demo')
    }
  })

  it('records an unattributed session event when no pre-handler actor exists', () => {
    const input = authAuditInput({
      method: 'POST',
      pathname: '/api/auth/user/revoke-sessions',
      status: 200,
      userId: null
    })
    expect(input?.eventType).toBe('auth.session_revoked')
    expect(input?.actorUserId).toBeNull()
  })

  it('ignores non-lifecycle auth traffic', () => {
    expect(
      authAuditInput({
        method: 'GET',
        pathname: '/api/auth/get-session',
        status: 200,
        userId: null
      })
    ).toBeNull()
    expect(
      authAuditInput({
        method: 'GET',
        pathname: '/api/auth/sign-in/email',
        status: 200,
        userId: null
      })
    ).toBeNull()
  })
})

describe('recordAuthAudit', () => {
  it('records a sign-out from the pre-handler actor without touching the body', async () => {
    // The response names nobody — the actor must come from the session read.
    const request = new Request('http://localhost/api/auth/sign-out', {
      method: 'POST'
    })
    const response = new Response(JSON.stringify({ success: true }), {
      status: 200
    })
    const clone = vi.spyOn(response, 'clone')
    const json = vi.spyOn(response, 'json')
    const outcome = await Effect.runPromise(
      Effect.scoped(
        recordAuthAudit(request, response, runCapabilities, { actorUserId: 'usr_demo' })
      )
    )
    expect(outcome).toBe('recorded')
    expect(runCapabilities).toHaveBeenCalledTimes(1)
    expect(clone).not.toHaveBeenCalled()
    expect(json).not.toHaveBeenCalled()
  })

  it('records a skipped exchange without touching the response body', async () => {
    const request = new Request('http://localhost/api/auth/get-session', {
      method: 'GET'
    })
    const response = new Response(JSON.stringify({ ok: true }), { status: 200 })
    const clone = vi.spyOn(response, 'clone')
    const json = vi.spyOn(response, 'json')
    await expect(runRecordAuthAudit(request, response)).resolves.toBe('skipped')
    expect(clone).not.toHaveBeenCalled()
    expect(json).not.toHaveBeenCalled()
  })

  it('parses the body only for exchanges that carry a user', async () => {
    const request = new Request('http://localhost/api/auth/sign-in/email', {
      method: 'POST'
    })
    const response = new Response(JSON.stringify({ user: { id: 'usr_demo' } }), {
      status: 200
    })
    const clone = vi.spyOn(response, 'clone')
    await expect(runRecordAuthAudit(request, response)).resolves.toBe('recorded')
    expect(clone).toHaveBeenCalledTimes(1)
  })

  it('does not parse the constant reset-request body', async () => {
    const request = new Request('http://localhost/api/auth/request-password-reset', {
      method: 'POST'
    })
    const response = new Response(
      JSON.stringify({ status: true, message: 'If this email exists…' }),
      { status: 200 }
    )
    const clone = vi.spyOn(response, 'clone')
    await expect(runRecordAuthAudit(request, response)).resolves.toBe('recorded')
    expect(clone).not.toHaveBeenCalled()
  })

  it('records a password reset without touching the body', async () => {
    const request = new Request('http://localhost/api/auth/reset-password', {
      method: 'POST'
    })
    const response = new Response(JSON.stringify({ status: true }), { status: 200 })
    const clone = vi.spyOn(response, 'clone')
    await expect(runRecordAuthAudit(request, response)).resolves.toBe('recorded')
    expect(clone).not.toHaveBeenCalled()
  })

  it('reports a dropped write instead of throwing when the audit fails', async () => {
    runCapabilities.mockRejectedValueOnce(new Error('d1 down'))
    const request = new Request('http://localhost/api/auth/sign-in/email', {
      method: 'POST'
    })
    const response = new Response(JSON.stringify({ user: { id: 'usr_demo' } }), {
      status: 200
    })
    await expect(runRecordAuthAudit(request, response)).resolves.toBe('dropped')
  })

  it('skips admin paths when no admin context was gathered', async () => {
    const request = new Request('http://localhost/api/auth/admin/set-role', {
      method: 'POST'
    })
    const response = new Response(JSON.stringify({ user: { id: 'usr_dev' } }), {
      status: 200
    })
    const clone = vi.spyOn(response, 'clone')
    await expect(runRecordAuthAudit(request, response)).resolves.toBe('skipped')
    expect(clone).not.toHaveBeenCalled()
  })
})

describe('two-factor lifecycle exchanges', () => {
  const enable = { method: 'POST', pathname: '/api/auth/two-factor/enable' }
  const disable = { method: 'POST', pathname: '/api/auth/two-factor/disable' }
  const verifyTotp = { method: 'POST', pathname: '/api/auth/two-factor/verify-totp' }

  it('audits enabling and disabling two-factor', () => {
    expect(isAuditedAuthExchange(enable)).toBe(true)
    expect(isAuditedAuthExchange(disable)).toBe(true)
    // Both endpoints require an authenticated session and their responses
    // carry secrets (totpURI, backupCodes), never an actor.
    expect(needsPreHandlerActor(enable)).toBe(true)
    expect(needsPreHandlerActor(disable)).toBe(true)
  })

  it('maps enable to an attributed pair, failures keeping the pre-handler actor', () => {
    expect(
      authAuditInput({ ...enable, status: 200, userId: 'usr_demo' })
    ).toMatchObject({
      eventType: 'auth.two_factor_enabled',
      actorUserId: 'usr_demo',
      targetType: 'user'
    })
    expect(
      authAuditInput({ ...enable, status: 400, userId: 'usr_demo' })
    ).toMatchObject({
      eventType: 'auth.two_factor_enabled_failed',
      actorUserId: 'usr_demo'
    })
  })

  it('maps disable to an attributed pair', () => {
    expect(
      authAuditInput({ ...disable, status: 200, userId: 'usr_demo' })
    ).toMatchObject({
      eventType: 'auth.two_factor_disabled',
      actorUserId: 'usr_demo',
      targetType: 'user'
    })
    expect(
      authAuditInput({ ...disable, status: 401, userId: 'usr_demo' })
    ).toMatchObject({
      eventType: 'auth.two_factor_disable_failed',
      actorUserId: 'usr_demo'
    })
  })

  it('audits the TOTP verification challenge', () => {
    expect(isAuditedAuthExchange(verifyTotp)).toBe(true)
    // The verification response names its user on success; on failure there is
    // no trustworthy actor (the sign-in challenge may carry no session yet).
    expect(needsPreHandlerActor(verifyTotp)).toBe(false)
    expect(
      authAuditInput({ ...verifyTotp, status: 200, userId: 'usr_challenge' })
    ).toMatchObject({
      eventType: 'auth.two_factor_verified',
      actorUserId: 'usr_challenge',
      targetType: 'session'
    })
    expect(authAuditInput({ ...verifyTotp, status: 401, userId: null })).toMatchObject({
      eventType: 'auth.two_factor_verification_failed',
      actorUserId: null
    })
  })
})

describe('isAdminAuthExchange', () => {
  it('accepts the audited admin mutations', () => {
    for (const suffix of [
      '/admin/set-role',
      '/admin/ban-user',
      '/admin/unban-user',
      '/admin/create-user',
      '/admin/remove-user',
      '/admin/set-user-password',
      '/admin/impersonate-user',
      '/admin/stop-impersonating',
      '/admin/revoke-user-session',
      '/admin/revoke-user-sessions'
    ]) {
      expect(
        isAdminAuthExchange({ method: 'POST', pathname: `/api/auth${suffix}` })
      ).toBe(true)
    }
  })

  it('rejects reads and non-admin auth traffic', () => {
    expect(
      isAdminAuthExchange({ method: 'GET', pathname: '/api/auth/admin/list-users' })
    ).toBe(false)
    expect(
      isAdminAuthExchange({ method: 'POST', pathname: '/api/auth/sign-in/email' })
    ).toBe(false)
    expect(
      isAdminAuthExchange({ method: 'POST', pathname: '/api/auth/admin/list-users' })
    ).toBe(false)
  })
})

describe('adminAuditInput', () => {
  const pathname = '/api/auth/admin/set-role'

  it('maps a successful role change to an attributed system_admin event', () => {
    expect(
      adminAuditInput({
        pathname,
        status: 200,
        actorUserId: 'usr_martin',
        targetUserId: 'usr_dev'
      })
    ).toEqual({
      workspaceId: null,
      actorUserId: 'usr_martin',
      eventType: 'system_admin.user_role_changed',
      targetType: 'user',
      targetId: 'usr_dev',
      metadata: { statusCode: 200 }
    })
  })

  it('keeps the actor on failure — the session predates the judgment', () => {
    const input = adminAuditInput({
      pathname,
      status: 400,
      actorUserId: 'usr_martin',
      targetUserId: 'usr_dev'
    })
    expect(input?.eventType).toBe('system_admin.user_role_change_failed')
    expect(input?.actorUserId).toBe('usr_martin')
  })

  it('covers the full success/failure pair per endpoint from one table', () => {
    const pairs: ReadonlyArray<readonly [string, string, string]> = [
      [
        '/api/auth/admin/create-user',
        'system_admin.user_created',
        'system_admin.user_creation_failed'
      ],
      [
        '/api/auth/admin/remove-user',
        'system_admin.user_removed',
        'system_admin.user_removal_failed'
      ],
      [
        '/api/auth/admin/ban-user',
        'system_admin.user_banned',
        'system_admin.user_ban_failed'
      ],
      [
        '/api/auth/admin/unban-user',
        'system_admin.user_unbanned',
        'system_admin.user_unban_failed'
      ],
      [
        '/api/auth/admin/set-user-password',
        'system_admin.user_password_set',
        'system_admin.user_password_set_failed'
      ],
      [
        '/api/auth/admin/impersonate-user',
        'system_admin.impersonation_started',
        'system_admin.impersonation_start_failed'
      ],
      [
        '/api/auth/admin/stop-impersonating',
        'system_admin.impersonation_stopped',
        'system_admin.impersonation_stop_failed'
      ],
      [
        '/api/auth/admin/revoke-user-sessions',
        'system_admin.user_session_revoked',
        'system_admin.user_session_revocation_failed'
      ]
    ]
    for (const [path, success, failure] of pairs) {
      expect(
        adminAuditInput({
          pathname: path,
          status: 200,
          actorUserId: 'a',
          targetUserId: null
        })?.eventType
      ).toBe(success)
      expect(
        adminAuditInput({
          pathname: path,
          status: 500,
          actorUserId: 'a',
          targetUserId: null
        })?.eventType
      ).toBe(failure)
    }
  })

  it('targets an unknown user for stop-impersonating (no id in its request)', () => {
    const input = adminAuditInput({
      pathname: '/api/auth/admin/stop-impersonating',
      status: 200,
      actorUserId: 'usr_martin',
      targetUserId: null
    })
    expect(input?.targetType).toBe('user')
    expect(input?.targetId).toBeNull()
  })

  it('ignores non-admin traffic', () => {
    expect(
      adminAuditInput({
        pathname: '/api/auth/sign-in/email',
        status: 200,
        actorUserId: 'usr_martin',
        targetUserId: 'usr_dev'
      })
    ).toBeNull()
  })
})

describe('recordAuthAudit with a pre-handler context', () => {
  function runAdminAudit(
    request: Request,
    response: Response,
    context: AuthAuditContext
  ): Promise<AuthAuditOutcome> {
    return Effect.runPromise(
      Effect.scoped(recordAuthAudit(request, response, runCapabilities, context))
    )
  }

  it('records a role change attributed to the acting admin, target from the body', async () => {
    const request = new Request('http://localhost/api/auth/admin/set-role', {
      method: 'POST',
      body: JSON.stringify({ userId: 'usr_dev', role: 'admin' }),
      headers: { 'content-type': 'application/json' }
    })
    const response = new Response(JSON.stringify({ user: { id: 'usr_dev' } }), {
      status: 200
    })
    await expect(
      runAdminAudit(request, response, {
        actorUserId: 'usr_martin',
        request: request.clone()
      })
    ).resolves.toBe('recorded')
    expect(runCapabilities).toHaveBeenCalledTimes(1)
  })

  it('falls back to the response body for create-user, whose request names no user', async () => {
    const request = new Request('http://localhost/api/auth/admin/create-user', {
      method: 'POST'
    })
    const response = new Response(JSON.stringify({ user: { id: 'usr_new' } }), {
      status: 201
    })
    await expect(
      runAdminAudit(request, response, { actorUserId: 'usr_martin' })
    ).resolves.toBe('recorded')
  })

  it('records a rejected admin mutation with the failure event', async () => {
    const request = new Request('http://localhost/api/auth/admin/ban-user', {
      method: 'POST'
    })
    const response = new Response(JSON.stringify({ message: 'nope' }), { status: 403 })
    await expect(
      runAdminAudit(request, response, {
        actorUserId: 'usr_martin',
        request: request.clone()
      })
    ).resolves.toBe('recorded')
  })

  it('reports a dropped admin write instead of throwing', async () => {
    runCapabilities.mockRejectedValueOnce(new Error('d1 down'))
    const request = new Request('http://localhost/api/auth/admin/unban-user', {
      method: 'POST'
    })
    const response = new Response('{}', { status: 200 })
    await expect(
      runAdminAudit(request, response, {
        actorUserId: 'usr_martin',
        request: request.clone()
      })
    ).resolves.toBe('dropped')
  })

  it('records a session revocation attributed to the pre-handler actor', async () => {
    const request = new Request('http://localhost/api/auth/user/revoke-session', {
      method: 'POST'
    })
    const response = new Response('{}', { status: 200 })
    await expect(
      runAdminAudit(request, response, { actorUserId: 'usr_demo' })
    ).resolves.toBe('recorded')
    expect(runCapabilities).toHaveBeenCalledWith(expect.anything())
  })
})
