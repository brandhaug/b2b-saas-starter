import { describe, expect, it } from 'vite-plus/test'
import { auditRequiredEnv, requireEmailVerification } from './server.ts'

describe('requireEmailVerification', () => {
  it('is on in production only', () => {
    expect(requireEmailVerification('production')).toBe(true)
  })

  it('stays off for local dev and every non-production environment', () => {
    expect(requireEmailVerification(undefined)).toBe(false)
    expect(requireEmailVerification('')).toBe(false)
    expect(requireEmailVerification('staging')).toBe(false)
    expect(requireEmailVerification('preview')).toBe(false)
  })
})

describe('auditRequiredEnv', () => {
  const realSecret = 'a-real-deployment-secret-at-least-32-chars-long'
  const realUrl = 'https://app.acme.test'

  it('stays silent in local mode: no ENVIRONMENT means dev/test defaults are expected', () => {
    expect(auditRequiredEnv({})).toEqual({ mode: 'local', problems: [] })
  })

  it('treats explicitly null bindings as absent — a deployed worker must not crash the module-scope audit', () => {
    // workerd delivers present-but-null bindings as `null`, and the deploy
    // boundary has shipped explicit nulls for unset optional vars. Null is
    // "unset": local stance, no problems — not a `null.length` crash.
    const audit = auditRequiredEnv({
      BETTER_AUTH_SECRET: null,
      BETTER_AUTH_URL: null,
      ENVIRONMENT: null
    })
    expect(audit.mode).toBe('local')
    expect(audit.problems).toEqual([])
  })

  it('reports a missing secret and URL in production', () => {
    const audit = auditRequiredEnv({ ENVIRONMENT: 'production' })
    expect(audit.mode).toBe('production')
    expect(audit.problems).toContainEqual({
      key: 'BETTER_AUTH_SECRET',
      reason: 'missing'
    })
    expect(audit.problems).toContainEqual({
      key: 'BETTER_AUTH_URL',
      reason: 'missing'
    })
  })

  it('rejects the local-dev default secret by value in production', () => {
    // The exact mistake the audit exists for: a copied-from-dev secret is
    // 40 chars, so only value rejection — not the length check — catches it.
    const audit = auditRequiredEnv({
      ENVIRONMENT: 'production',
      BETTER_AUTH_SECRET: 'local-dev-secret-change-me-minimum-32-chars',
      BETTER_AUTH_URL: realUrl
    })
    expect(audit.problems).toEqual([
      { key: 'BETTER_AUTH_SECRET', reason: 'placeholder' }
    ])
  })

  it('rejects Better Auth own fallback and short secrets', () => {
    const fallback = auditRequiredEnv({
      ENVIRONMENT: 'production',
      BETTER_AUTH_SECRET: 'better-auth-secret-12345678901234567890',
      BETTER_AUTH_URL: realUrl
    })
    expect(fallback.problems).toEqual([
      { key: 'BETTER_AUTH_SECRET', reason: 'placeholder' }
    ])
    const short = auditRequiredEnv({
      ENVIRONMENT: 'production',
      BETTER_AUTH_SECRET: 'too-short-secret',
      BETTER_AUTH_URL: realUrl
    })
    expect(short.problems).toEqual([{ key: 'BETTER_AUTH_SECRET', reason: 'too-short' }])
  })

  it('rejects placeholder URLs: the documented one, example.com hosts, localhost', () => {
    for (const url of [
      'https://b2b-saas-starter.example.com',
      'https://app.example.com',
      'http://localhost:3071'
    ]) {
      const audit = auditRequiredEnv({
        ENVIRONMENT: 'production',
        BETTER_AUTH_SECRET: realSecret,
        BETTER_AUTH_URL: url
      })
      expect(audit.problems).toEqual([
        { key: 'BETTER_AUTH_URL', reason: 'placeholder' }
      ])
    }
  })

  it('passes real values in production and audits non-production deploys too', () => {
    expect(
      auditRequiredEnv({
        ENVIRONMENT: 'production',
        BETTER_AUTH_SECRET: realSecret,
        BETTER_AUTH_URL: realUrl
      })
    ).toEqual({ mode: 'production', problems: [] })

    const staging = auditRequiredEnv({ ENVIRONMENT: 'staging' })
    expect(staging.mode).toBe('deployed')
    expect(staging.problems.length).toBeGreaterThan(0)
  })

  it('accepts well-formed trusted origins, including Better Auth wildcards', () => {
    expect(
      auditRequiredEnv({
        ENVIRONMENT: 'production',
        BETTER_AUTH_SECRET: realSecret,
        BETTER_AUTH_URL: realUrl,
        BETTER_AUTH_TRUSTED_ORIGINS:
          'https://app.acme.test, https://admin.acme.test, *.preview.acme.test, https://*.acme.test'
      }).problems
    ).toEqual([])
  })

  it('flags malformed trusted-origin entries', () => {
    for (const origins of [
      'not-a-url',
      // A scheme-less entry that is not the wildcard form.
      'app.acme.test',
      // A wildcard with nowhere valid to anchor.
      '*'
    ]) {
      const audit = auditRequiredEnv({
        ENVIRONMENT: 'production',
        BETTER_AUTH_SECRET: realSecret,
        BETTER_AUTH_URL: realUrl,
        BETTER_AUTH_TRUSTED_ORIGINS: origins
      })
      expect(audit.problems).toEqual([
        { key: 'BETTER_AUTH_TRUSTED_ORIGINS', reason: 'malformed' }
      ])
    }
  })
})
