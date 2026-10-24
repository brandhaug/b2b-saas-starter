import { revokeSession, revokeSessions, revokeOtherSessions } from 'better-auth/api'
import { admin } from 'better-auth/plugins/admin'
import { describe, expect, it } from 'vite-plus/test'
import { exchangeRow, recoveryEvidence, needsPreHandlerActor } from './exchanges'

describe('installed Better Auth endpoint contract', () => {
  // Failure modes: target evidence attributed to the admin, missing mappings,
  // or an unban/promotion lifting an earlier recovery restriction.
  it.each([
    { endpoint: admin().endpoints.banUser, kind: 'account_banned' },
    { endpoint: admin().endpoints.setRole, kind: 'system_role_changed' }
  ])('records target-user evidence for $endpoint.path', ({ endpoint, kind }) => {
    const exchange = { method: 'POST', pathname: `/api/auth${endpoint.path}` }
    expect(
      recoveryEvidence(exchange, { actorUserId: 'admin', targetUserId: 'target' })
    ).toEqual({ kind, subjectId: 'target' })
    expect(recoveryEvidence(exchange, { actorUserId: 'admin' })).toBeUndefined()
    expect(
      recoveryEvidence(
        { ...exchange, method: 'GET' },
        { actorUserId: 'admin', targetUserId: 'target' }
      )
    ).toBeUndefined()
  })

  it('never emits restoration evidence for an unban', () => {
    expect(
      recoveryEvidence(
        { method: 'POST', pathname: `/api/auth${admin().endpoints.unbanUser.path}` },
        { actorUserId: 'admin', targetUserId: 'target' }
      )
    ).toBeUndefined()
  })

  it.each([revokeSession, revokeSessions, revokeOtherSessions])(
    'audits and records recovery evidence for $path',
    (endpoint) => {
      const exchange = { method: 'POST', pathname: `/api/auth${endpoint.path}` }
      expect(needsPreHandlerActor(exchange)).toBe(true)
      expect(exchangeRow(exchange)?.success).toBe('auth.session_revoked')
      expect(recoveryEvidence(exchange, { actorUserId: 'actor' })).toEqual({
        kind: 'sessions_revoked',
        subjectId: 'actor'
      })
      expect(
        recoveryEvidence({ ...exchange, method: 'GET' }, { actorUserId: 'actor' })
      ).toBeUndefined()
    }
  )

  it('resolves the admin single-session token before revocation', () => {
    const endpoint = admin().endpoints.revokeUserSession
    const exchange = { method: 'POST', pathname: `/api/auth${endpoint.path}` }
    expect(endpoint.options.body.parse({ sessionToken: 'token' })).toEqual({
      sessionToken: 'token'
    })
    expect(exchangeRow(exchange)?.targetFrom).toEqual(['session-token'])
    expect(
      recoveryEvidence(exchange, { actorUserId: 'admin', targetUserId: 'target' })
    ).toEqual({
      kind: 'sessions_revoked',
      subjectId: 'target'
    })
  })
})
