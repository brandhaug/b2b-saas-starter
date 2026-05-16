import { Schema } from 'effect'

const optional = Schema.optional(Schema.String)

export const ServerEnvSchema = Schema.Struct({
  BETTER_AUTH_SECRET: Schema.String,
  BETTER_AUTH_URL: Schema.String,
  BETTER_AUTH_TRUSTED_ORIGINS: optional,
  PUBLIC_SITE_URL: Schema.String,
  GITHUB_CLIENT_ID: optional,
  GITHUB_CLIENT_SECRET: optional,
  STRIPE_SECRET_KEY: optional,
  STRIPE_WEBHOOK_SECRET: optional,
  SENTRY_DSN: optional,
  POSTHOG_KEY: optional,
  POSTHOG_HOST: optional,
  CLOUDFLARE_EMAIL_FROM: optional,
  TURNSTILE_SITE_KEY: optional,
  TURNSTILE_SECRET_KEY: optional,
  WORKERS_AI_ENABLED: optional,
  OPENAI_API_KEY: optional
})

export type ServerEnv = typeof ServerEnvSchema.Type

export type ModuleConfigStatus = {
  readonly moduleId: string
  readonly configured: boolean
  readonly envPresent: boolean
  readonly missing: readonly string[]
}

const hasValue = (value: string | undefined): boolean =>
  typeof value === 'string' && value.length > 0

type RequiredLocalDefaults = Pick<
  ServerEnv,
  'BETTER_AUTH_SECRET' | 'BETTER_AUTH_URL' | 'PUBLIC_SITE_URL'
>

export function readServerEnv(
  source: Record<string, string | undefined>,
  options?: { readonly mode?: 'local' | 'strict' }
) {
  const localDefaults: Partial<RequiredLocalDefaults> =
    options?.mode === 'strict'
      ? {}
      : {
          BETTER_AUTH_SECRET: 'local-dev-secret-change-me-minimum-32-chars',
          BETTER_AUTH_URL: 'http://localhost:3071',
          PUBLIC_SITE_URL: 'http://localhost:3071'
        }
  return Schema.decodeUnknownSync(ServerEnvSchema)({
    BETTER_AUTH_SECRET: source.BETTER_AUTH_SECRET ?? localDefaults.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: source.BETTER_AUTH_URL ?? localDefaults.BETTER_AUTH_URL,
    BETTER_AUTH_TRUSTED_ORIGINS: source.BETTER_AUTH_TRUSTED_ORIGINS,
    PUBLIC_SITE_URL: source.PUBLIC_SITE_URL ?? localDefaults.PUBLIC_SITE_URL,
    GITHUB_CLIENT_ID: source.GITHUB_CLIENT_ID,
    GITHUB_CLIENT_SECRET: source.GITHUB_CLIENT_SECRET,
    STRIPE_SECRET_KEY: source.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: source.STRIPE_WEBHOOK_SECRET,
    SENTRY_DSN: source.SENTRY_DSN,
    POSTHOG_KEY: source.POSTHOG_KEY,
    POSTHOG_HOST: source.POSTHOG_HOST,
    CLOUDFLARE_EMAIL_FROM: source.CLOUDFLARE_EMAIL_FROM,
    TURNSTILE_SITE_KEY: source.TURNSTILE_SITE_KEY,
    TURNSTILE_SECRET_KEY: source.TURNSTILE_SECRET_KEY,
    WORKERS_AI_ENABLED: source.WORKERS_AI_ENABLED,
    OPENAI_API_KEY: source.OPENAI_API_KEY
  })
}

export function moduleConfigStatus(env: ServerEnv): readonly ModuleConfigStatus[] {
  const status = (
    moduleId: string,
    required: readonly (keyof ServerEnv)[],
    options?: { readonly runtimeWired?: boolean }
  ): ModuleConfigStatus => {
    const missing = required.filter((key) => !hasValue(env[key]))
    const envPresent = missing.length === 0
    return {
      moduleId,
      configured: envPresent && (options?.runtimeWired ?? true),
      envPresent,
      missing
    }
  }

  return [
    status('better-auth', ['BETTER_AUTH_SECRET', 'BETTER_AUTH_URL']),
    status('github-oauth', ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET']),
    status('billing', ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'], {
      runtimeWired: false
    }),
    status('observability', ['SENTRY_DSN', 'POSTHOG_KEY'], {
      runtimeWired: false
    }),
    status('cloudflare-email', ['CLOUDFLARE_EMAIL_FROM']),
    status('turnstile', ['TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY'])
  ]
}

export function redactedEnvStatus(env: ServerEnv) {
  return moduleConfigStatus(env).map((item) => ({
    ...item,
    values: item.configured ? 'configured' : item.envPresent ? 'env-present' : 'missing'
  }))
}
