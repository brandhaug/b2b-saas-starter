import { describe, expect, it } from 'vitest'
import {
  makeStarterEnvModuleConfig,
  moduleConfigStatus,
  optionalModuleEnvKeys,
  readServerEnv,
  redactedEnvStatus,
  serverEnvKeys,
  ServerEnvSchema
} from './server.ts'

const statusFor = (env: Record<string, string | undefined>, moduleId: string) => {
  const status = moduleConfigStatus(readServerEnv(env)).find(
    (item) => item.moduleId === moduleId
  )
  if (status === undefined) throw new Error(`unknown module ${moduleId}`)
  return status
}

describe('readServerEnv', () => {
  it('boots provider-light: an empty env decodes via local defaults', () => {
    const env = readServerEnv({})
    expect(env.STRIPE_SECRET_KEY).toBeUndefined()
  })

  it('ignores retired Public Site authentication variables', () => {
    const env = readServerEnv({
      BETTER_AUTH_SECRET: 'retired',
      BETTER_AUTH_URL: 'https://public.example.com',
      GITHUB_CLIENT_ID: 'retired'
    })
    expect(env).not.toHaveProperty('BETTER_AUTH_SECRET')
    expect(env).not.toHaveProperty('BETTER_AUTH_URL')
    expect(env).not.toHaveProperty('GITHUB_CLIENT_ID')
  })

  it('accepts a raw worker env: bindings and unknown keys are ignored', () => {
    const env = readServerEnv({
      DB: { fake: 'd1-binding' },
      RATE_LIMITER_REST: { limit: () => Promise.resolve({ success: true }) },
      CLOUDFLARE_EMAIL_FROM: 'no-reply@example.com'
    })
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
    const email = statusFor({}, 'cloudflare-email')
    expect(email.envPresent).toBe(false)
    expect(email.configured).toBe(false)
    expect(email.missing).toEqual(['CLOUDFLARE_EMAIL_FROM'])
  })

  it('requires every var: a partially configured module stays unconfigured', () => {
    const turnstile = statusFor({ TURNSTILE_SITE_KEY: 'site-key' }, 'turnstile')
    expect(turnstile.envPresent).toBe(false)
    expect(turnstile.missing).toEqual(['TURNSTILE_SECRET_KEY'])
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
    expect(JSON.stringify(status)).not.toContain('no-reply@example.com')
  })
})
