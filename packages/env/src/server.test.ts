import { describe, expect, it } from 'vitest'
import {
  auditRequiredEnv,
  makeStarterEnvModuleConfig,
  moduleConfigStatus,
  optionalModuleEnvKeys,
  readServerEnv,
  redactedEnvStatus,
  serverEnvKeys,
  ServerEnvSchema
} from './server.ts'

function statusFor(env: Record<string, string | undefined>, moduleId: string) {
  const status = moduleConfigStatus(readServerEnv(env)).find(
    (item) => item.moduleId === moduleId
  )
  if (status === undefined) throw new Error(`unknown module ${moduleId}`)
  return status
}

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

describe('moduleConfigStatus', () => {
  it('reports missing var names (redacted: names only) when env is unset', () => {
    const github = statusFor({}, 'github-oauth')
    expect(github.envPresent).toBe(false)
    expect(github.configured).toBe(false)
    expect(github.missing).toEqual(['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET'])
  })

  it('requires every var: a partially configured module stays unconfigured', () => {
    const github = statusFor({ GITHUB_CLIENT_ID: 'iv1.abc' }, 'github-oauth')
    expect(github.envPresent).toBe(false)
    expect(github.missing).toEqual(['GITHUB_CLIENT_SECRET'])
  })

  it('treats empty strings as unset', () => {
    const turnstile = statusFor(
      { TURNSTILE_SITE_KEY: '', TURNSTILE_SECRET_KEY: '' },
      'turnstile'
    )
    expect(turnstile.envPresent).toBe(false)
    expect(turnstile.missing).toEqual(['TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY'])
  })

  it('marks a module configured when all required vars are present', () => {
    const email = statusFor(
      { CLOUDFLARE_EMAIL_FROM: 'no-reply@example.com' },
      'cloudflare-email'
    )
    expect(email.envPresent).toBe(true)
    expect(email.configured).toBe(true)
    expect(email.missing).toEqual([])
  })

  it('keeps runtime-unwired modules unconfigured even with env present', () => {
    const billing = statusFor(
      { STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_x' },
      'billing'
    )
    expect(billing.envPresent).toBe(true)
    expect(billing.configured).toBe(false)
  })

  it('observability configures on the OTLP endpoint alone', () => {
    const observability = statusFor(
      { OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318' },
      'observability'
    )
    expect(observability.configured).toBe(true)
    expect(observability.envPresent).toBe(true)
    expect(observability.missing).toEqual([])
  })

  it('treats Sentry and PostHog as independent reserved hooks', () => {
    // Either hook alone means "present but unwired" — they activate different
    // providers, so neither implies the other.
    const sentryOnly = statusFor(
      { SENTRY_DSN: 'https://key@sentry.io/1' },
      'observability'
    )
    expect(sentryOnly.envPresent).toBe(true)
    expect(sentryOnly.configured).toBe(false)
    // `missing` names what reaching `configured` needs, not what env lacks.
    expect(sentryOnly.missing).toEqual(['OTEL_EXPORTER_OTLP_ENDPOINT'])

    const posthogOnly = statusFor({ POSTHOG_KEY: 'phc_test' }, 'observability')
    expect(posthogOnly.envPresent).toBe(true)
    expect(posthogOnly.configured).toBe(false)
    expect(posthogOnly.missing).toEqual(['OTEL_EXPORTER_OTLP_ENDPOINT'])
  })

  it('reports observability unset when no exporter and no reserved hook exist', () => {
    const observability = statusFor({}, 'observability')
    expect(observability.configured).toBe(false)
    expect(observability.envPresent).toBe(false)
    expect(observability.missing).toEqual(['OTEL_EXPORTER_OTLP_ENDPOINT'])
  })

  it('ai activates on either Workers AI flag or an OpenAI key', () => {
    const unset = statusFor({}, 'ai')
    expect(unset.configured).toBe(false)
    expect(unset.missing).toEqual(['WORKERS_AI_ENABLED', 'OPENAI_API_KEY'])

    // WORKERS_AI_ENABLED must be the literal 'true' — 'false' is not "present".
    expect(statusFor({ WORKERS_AI_ENABLED: 'false' }, 'ai').configured).toBe(false)
    expect(statusFor({ WORKERS_AI_ENABLED: 'true' }, 'ai').configured).toBe(true)
    expect(statusFor({ OPENAI_API_KEY: 'sk-x' }, 'ai').configured).toBe(true)
  })
})

describe('makeStarterEnvModuleConfig', () => {
  it('is the readServerEnv + moduleConfigStatus recipe over a raw worker env', () => {
    const raw = {
      DB: { fake: 'd1-binding' },
      CLOUDFLARE_EMAIL_FROM: 'no-reply@example.com'
    }
    expect(makeStarterEnvModuleConfig(raw)).toEqual(
      moduleConfigStatus(readServerEnv(raw))
    )
    const email = makeStarterEnvModuleConfig(raw).find(
      (item) => item.moduleId === 'cloudflare-email'
    )
    expect(email?.configured).toBe(true)
  })
})

describe('redactedEnvStatus', () => {
  it('summarizes without leaking values', () => {
    const status = redactedEnvStatus(
      readServerEnv({ CLOUDFLARE_EMAIL_FROM: 'no-reply@example.com' })
    )
    const email = status.find((item) => item.moduleId === 'cloudflare-email')
    expect(email?.values).toBe('configured')
    // The assertion IS about the raw serialization: no secret value may appear anywhere
    // in the serialized status, whatever its shape. A Schema codec would only check the
    // fields it declares, which is a strictly weaker redaction guarantee.
    // oxlint-disable-next-line effect/noGlobals -- serialization is the thing under test
    expect(JSON.stringify(status)).not.toContain('no-reply@example.com')
  })
})

describe('auditRequiredEnv', () => {
  const realSecret = 'a-real-deployment-secret-at-least-32-chars-long'
  const realUrl = 'https://app.acme.test'

  it('stays silent in local mode: no ENVIRONMENT means dev/test defaults are expected', () => {
    expect(auditRequiredEnv({})).toEqual({ mode: 'local', problems: [] })
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
})
