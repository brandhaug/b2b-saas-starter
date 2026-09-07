import { describe, expect, it } from '@effect/vitest'
import { DateTime } from 'effect'
import {
  acceptsSsoProof,
  hasRecentAuthentication,
  normalizeSsoDomain,
  proofExpiry,
  requiresHumanSsoProof,
  SSO_DEFAULT_PROOF_TTL_MS
} from './sso-policy.ts'

describe('SSO policy', () => {
  it('normalizes exact domains and rejects ambiguous claims', () => {
    expect(normalizeSsoDomain(' Example.COM. ')).toBe('example.com')
    expect(normalizeSsoDomain('example.com,other.com')).toBeUndefined()
    expect(normalizeSsoDomain('user@example.com')).toBeUndefined()
    expect(normalizeSsoDomain('*.example.com')).toBeUndefined()
    expect(normalizeSsoDomain('https://example.com/path')).toBeUndefined()
    expect(normalizeSsoDomain('-example.com')).toBeUndefined()
    expect(normalizeSsoDomain('example-.com')).toBeUndefined()
    expect(normalizeSsoDomain('localhost')).toBeUndefined()
    expect(normalizeSsoDomain('xn--bcher-kva.example')).toBe('xn--bcher-kva.example')
  })

  it('binds proof to session, provider and generation for twelve hours', () => {
    const authenticatedAt = '2026-09-07T10:00:00.000Z'
    const proof = {
      workspaceId: 'w',
      userId: 'u',
      sessionId: 's',
      providerId: 'p',
      connectionGeneration: 2,
      authenticatedAt,
      expiresAt: proofExpiry(authenticatedAt)
    }
    expect(proof.expiresAt).toBe(
      DateTime.formatIso(
        DateTime.addDuration(
          DateTime.makeUnsafe(authenticatedAt),
          SSO_DEFAULT_PROOF_TTL_MS
        )
      )
    )
    expect(
      acceptsSsoProof(proof, {
        workspaceId: 'w',
        userId: 'u',
        sessionId: 's',
        providerId: 'p',
        connectionGeneration: 2,
        now: '2026-09-07T11:00:00.000Z'
      })
    ).toBe(true)
    expect(
      acceptsSsoProof(proof, {
        workspaceId: 'w',
        userId: 'u',
        sessionId: 's',
        providerId: 'p',
        connectionGeneration: 3,
        now: '2026-09-07T11:00:00.000Z'
      })
    ).toBe(false)
    expect(
      acceptsSsoProof(proof, {
        workspaceId: 'w',
        userId: 'u',
        sessionId: 's',
        providerId: 'p',
        connectionGeneration: 2,
        now: proof.expiresAt
      })
    ).toBe(false)
  })

  it('requires recent independent authentication for mutation', () => {
    expect(
      hasRecentAuthentication('2026-09-07T10:00:00.000Z', '2026-09-07T10:04:59.000Z')
    ).toBe(true)
    expect(
      hasRecentAuthentication('2026-09-07T10:00:00.000Z', '2026-09-07T10:05:01.000Z')
    ).toBe(false)
    expect(
      hasRecentAuthentication('2026-09-07T10:01:00.000Z', '2026-09-07T10:00:00.000Z')
    ).toBe(false)
    expect(requiresHumanSsoProof('user')).toBe(true)
    expect(requiresHumanSsoProof('api_token')).toBe(false)
    expect(requiresHumanSsoProof('system')).toBe(true)
  })
})
