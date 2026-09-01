import { describe, expect, it } from 'vite-plus/test'
import {
  auditRequiredEnv,
  optionalModuleEnvKeys,
  readServerEnv,
  requireEmailVerification,
  serverEnvKeys,
  ServerEnvSchema
} from './server.ts'

describe('readServerEnv', () => {
  it('boots provider-light: an empty env decodes via local defaults', () => {
    const env = readServerEnv({})
    expect(env.BETTER_AUTH_URL).toBe('http://localhost:3071')
    expect(env.STRIPE_SECRET_KEY).toBeUndefined()
  })

  it('fails fast in strict mode when required baseline vars are missing', () => {
    // The schema names the first missing baseline var, so a strict-mode boot
    // failure says which var to set instead of failing opaquely.
    expect(() => readServerEnv({}, { mode: 'strict' })).toThrow(/BETTER_AUTH_SECRET/)
  })

  it('prefers real values over local defaults', () => {
    const env = readServerEnv({ BETTER_AUTH_URL: 'https://app.example.com' })
    expect(env.BETTER_AUTH_URL).toBe('https://app.example.com')
  })

  it('accepts a raw worker env: bindings and unknown keys are ignored', () => {
    // Shaped like a real worker env — bindings beside the vars.
    const workerEnv = {
      DB: { fake: 'd1-binding' },
      RATE_LIMITER_REST: { limit: () => Promise.resolve({ success: true }) },
      CLOUDFLARE_EMAIL_FROM: 'no-reply@example.com'
    }
    const env = readServerEnv(workerEnv)
    expect(env.CLOUDFLARE_EMAIL_FROM).toBe('no-reply@example.com')
    expect('DB' in env).toBe(false)
  })

  it('treats explicitly null bindings as absent (workerd delivers present-but-null)', () => {
    // The deploy boundary has shipped explicit nulls for unset optional vars
    // (alchemy forwarded `undefined ?? null`), and workerd delivers null
    // verbatim. Every read must normalize that to "unconfigured" instead of
    // crashing on string operations — the first green deploy 500ed on
    // exactly this.
    const env = readServerEnv({
      BETTER_AUTH_SECRET: null,
      BETTER_AUTH_URL: null,
      ENVIRONMENT: null,
      STRIPE_SECRET_KEY: null
    })
    expect(env.BETTER_AUTH_URL).toBe('http://localhost:3071')
    expect(env.STRIPE_SECRET_KEY).toBeUndefined()
    expect(env.ENVIRONMENT).toBeUndefined()
  })
})

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

describe('schema-derived key lists', () => {
  it('serverEnvKeys mirrors the schema fields exactly', () => {
    expect(serverEnvKeys).toEqual(Object.keys(ServerEnvSchema.fields))
  })

  it('every optional module env key is a schema key', () => {
    for (const key of optionalModuleEnvKeys) {
      expect(serverEnvKeys).toContain(key)
    }
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
