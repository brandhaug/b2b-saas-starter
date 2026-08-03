import { describe, expect, it, vi } from 'vitest'
import { makeMerchantRequestAuthority } from './merchant-request-authority.ts'

const authorization = {
  impersonationId: 'imp_request',
  operatorId: 'opr_request',
  operatorName: 'Request Operator',
  operatorSessionId: 'ops_request',
  targetMemberId: 'mem_request',
  targetName: 'Request Target',
  merchantId: 'mer_request',
  merchantName: 'Request Merchant',
  merchantSessionId: 'mss_request',
  internalReason: 'Reproduce issue',
  supportReference: null
}

describe('Merchant request impersonation boundary', () => {
  it('returns null for optional navigation authorization without manufacturing an error', async () => {
    const unauthorized = vi.fn(() => new Error('unauthorized'))
    const authority = {
      authorize: vi.fn(),
      recordMutation: vi.fn()
    }
    const requests = makeMerchantRequestAuthority({
      readSession: async () => null,
      authority,
      unauthorized
    })

    await expect(requests.authorizeOptional('merchant.navigate')).resolves.toBeNull()
    expect(unauthorized).not.toHaveBeenCalled()
    expect(authority.authorize).not.toHaveBeenCalled()
  })

  it('reauthorizes an impersonated request and records the real outcome of mutations', async () => {
    const authority = {
      authorize: vi.fn().mockResolvedValue(authorization),
      recordMutation: vi.fn().mockResolvedValue(undefined)
    }
    const requests = makeMerchantRequestAuthority({
      readSession: async () => ({
        session: { id: 'mss_request', impersonatedBy: 'opr_request' },
        user: { id: 'mem_request' }
      }),
      authority,
      unauthorized: () => new Error('unauthorized')
    })

    await expect(
      requests.run('service.update', async (session) => session.user.id)
    ).resolves.toBe('mem_request')
    await expect(
      requests.run('schedule.update', async () => {
        throw new Error('invalid schedule')
      })
    ).rejects.toThrow('invalid schedule')

    expect(authority.authorize).toHaveBeenNthCalledWith(1, {
      merchantSessionId: 'mss_request',
      action: 'service.update'
    })
    expect(authority.recordMutation).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        authorization,
        action: 'service.update',
        result: 'accepted'
      })
    )
    expect(authority.recordMutation).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        authorization,
        action: 'schedule.update',
        result: 'rejected'
      })
    )
  })

  it('does not invoke impersonation authority for an ordinary Merchant Session', async () => {
    const authority = {
      authorize: vi.fn(),
      recordMutation: vi.fn()
    }
    const requests = makeMerchantRequestAuthority({
      readSession: async () => ({
        session: { id: 'mss_ordinary', impersonatedBy: null },
        user: { id: 'mem_ordinary' }
      }),
      authority,
      unauthorized: () => new Error('unauthorized')
    })

    await expect(
      requests.run('credential.create', async () => 'created')
    ).resolves.toBe('created')
    expect(authority.authorize).not.toHaveBeenCalled()
    expect(authority.recordMutation).not.toHaveBeenCalled()
  })

  it('authorizes a reused impersonated session without reading it again', async () => {
    const readSession = vi.fn()
    const authority = {
      authorize: vi.fn().mockResolvedValue(authorization),
      recordMutation: vi.fn()
    }
    const requests = makeMerchantRequestAuthority({
      readSession,
      authority,
      unauthorized: () => new Error('unauthorized')
    })
    const session = {
      session: { id: 'mss_request', impersonatedBy: 'opr_request' },
      user: { id: 'mem_request' }
    }

    await expect(
      requests.runSession(session, 'appointment.read', async (current) =>
        Promise.resolve(current.user.id)
      )
    ).resolves.toBe('mem_request')

    expect(readSession).not.toHaveBeenCalled()
    expect(authority.authorize).toHaveBeenCalledWith({
      merchantSessionId: 'mss_request',
      action: 'appointment.read'
    })
  })

  it('does not misreport a completed mutation when accepted evidence persistence fails', async () => {
    const authority = {
      authorize: vi.fn().mockResolvedValue(authorization),
      recordMutation: vi.fn().mockRejectedValue(new Error('audit unavailable'))
    }
    const requests = makeMerchantRequestAuthority({
      readSession: async () => ({
        session: { id: 'mss_request', impersonatedBy: 'opr_request' },
        user: { id: 'mem_request' }
      }),
      authority,
      unauthorized: () => new Error('unauthorized')
    })

    await expect(requests.run('service.update', async () => 'saved')).rejects.toThrow(
      'audit unavailable'
    )
    expect(authority.recordMutation).toHaveBeenCalledTimes(3)
    expect(authority.recordMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        authorization,
        action: 'service.update',
        result: 'accepted'
      })
    )
  })
})
