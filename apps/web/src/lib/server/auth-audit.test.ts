import { describe, expect, it, vi } from 'vitest'
import { isAuditedAuthExchange, recordAuthAudit, signInAuditInput } from './auth-audit'

vi.mock('@/lib/capabilities', () => ({
  runCapabilities: vi.fn().mockResolvedValue(undefined)
}))

describe('isAuditedAuthExchange', () => {
  it('accepts only POST credential sign-in exchanges', () => {
    expect(
      isAuditedAuthExchange({ method: 'POST', pathname: '/api/auth/sign-in/email' })
    ).toBe(true)
    expect(
      isAuditedAuthExchange({ method: 'GET', pathname: '/api/auth/sign-in/email' })
    ).toBe(false)
    expect(
      isAuditedAuthExchange({ method: 'POST', pathname: '/api/auth/sign-out' })
    ).toBe(false)
  })
})

describe('signInAuditInput', () => {
  it('maps a successful credential sign-in to an attributed audit event', () => {
    const input = signInAuditInput({
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
    const input = signInAuditInput({
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
    const input = signInAuditInput({
      method: 'POST',
      pathname: '/api/auth/sign-in/email',
      status: 500,
      userId: 'usr_demo'
    })
    expect(input?.actorUserId).toBeNull()
  })

  it('ignores non-sign-in auth traffic', () => {
    expect(
      signInAuditInput({
        method: 'POST',
        pathname: '/api/auth/sign-out',
        status: 200,
        userId: 'usr_demo'
      })
    ).toBeNull()
    expect(
      signInAuditInput({
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
    await expect(recordAuthAudit(request, response)).resolves.toBe('skipped')
    expect(clone).not.toHaveBeenCalled()
    expect(json).not.toHaveBeenCalled()
  })

  it('parses the body only for the audited sign-in exchange', async () => {
    const request = new Request('http://localhost/api/auth/sign-in/email', {
      method: 'POST'
    })
    const response = new Response(JSON.stringify({ user: { id: 'usr_demo' } }), {
      status: 200
    })
    const clone = vi.spyOn(response, 'clone')
    await expect(recordAuthAudit(request, response)).resolves.toBe('recorded')
    expect(clone).toHaveBeenCalledTimes(1)
  })

  it('reports a dropped write instead of throwing when the audit fails', async () => {
    const { runCapabilities } = await import('@/lib/capabilities')
    vi.mocked(runCapabilities).mockRejectedValueOnce(new Error('d1 down'))
    const request = new Request('http://localhost/api/auth/sign-in/email', {
      method: 'POST'
    })
    const response = new Response(JSON.stringify({ user: { id: 'usr_demo' } }), {
      status: 200
    })
    await expect(recordAuthAudit(request, response)).resolves.toBe('dropped')
  })
})
