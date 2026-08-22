import { Effect } from 'effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  authAuditInput,
  isAuditedAuthExchange,
  recordAuthAudit,
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
      isAuditedAuthExchange({ method: 'POST', pathname: '/api/auth/sign-up/email' })
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
      isAuditedAuthExchange({ method: 'POST', pathname: '/api/auth/sign-out' })
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
      metadata: { method: 'email', statusCode: 200 }
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

  it('ignores non-lifecycle auth traffic', () => {
    expect(
      authAuditInput({
        method: 'POST',
        pathname: '/api/auth/sign-out',
        status: 200,
        userId: 'usr_demo'
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
  it('never touches the response body for non-audit-worthy exchanges', async () => {
    const request = new Request('http://localhost/api/auth/sign-out', {
      method: 'POST'
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
})
