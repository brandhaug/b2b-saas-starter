import { Schema } from 'effect'

const optional = Schema.optional(Schema.String)

// Single source of truth for server env vars (ADR 0035). Add a new var HERE
// (and, when alchemy should forward it to deployed workers, to exactly one of
// the optional-module key lists below) — everything else derives from the
// schema: `readServerEnv` picks these keys, `alchemy.run.ts` builds its
// forwarding env from the key lists, and `apps/web/src/worker-env.d.ts`
// derives its string vars from `ServerEnv`.
export const ServerEnvSchema = Schema.Struct({
  BETTER_AUTH_SECRET: Schema.String,
  BETTER_AUTH_URL: Schema.String,
  BETTER_AUTH_TRUSTED_ORIGINS: optional,
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
  OPENAI_API_KEY: optional,
  OPENAI_BASE_URL: optional,
  OPENAI_MODEL_ID: optional
})

export type ServerEnv = typeof ServerEnvSchema.Type

/** Every env var the schema declares — derived from the schema, never hand-mirrored. */
export const serverEnvKeys = Object.keys(ServerEnvSchema.fields) as ReadonlyArray<
  keyof ServerEnv
>

// Optional module env forwarded by alchemy to all three workers. Secret keys
// are wrapped in `Redacted` at deploy time; plain keys are forwarded as-is.
// `satisfies` pins both lists to schema keys, so a typo or a var that was
// removed from the schema is a compile error.
export const optionalModuleEnvSecretKeys = [
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'TURNSTILE_SECRET_KEY',
  'OPENAI_API_KEY'
] as const satisfies ReadonlyArray<keyof ServerEnv>

export const optionalModuleEnvPlainKeys = [
  'SENTRY_DSN',
  'POSTHOG_KEY',
  'POSTHOG_HOST',
  'TURNSTILE_SITE_KEY',
  'CLOUDFLARE_EMAIL_FROM',
  'WORKERS_AI_ENABLED',
  'OPENAI_BASE_URL',
  'OPENAI_MODEL_ID'
] as const satisfies ReadonlyArray<keyof ServerEnv>

export const optionalModuleEnvKeys: ReadonlyArray<keyof ServerEnv> = [
  ...optionalModuleEnvSecretKeys,
  ...optionalModuleEnvPlainKeys
]

export type ModuleConfigStatus = {
  readonly moduleId: string
  readonly configured: boolean
  readonly envPresent: boolean
  readonly missing: readonly string[]
}

const hasValue = (value: string | undefined): boolean =>
  typeof value === 'string' && value.length > 0

export function readServerEnv(
  source: Record<string, unknown>,
  options?: { readonly mode?: 'local' | 'strict' }
): ServerEnv {
  const localDefaults: Partial<ServerEnv> =
    options?.mode === 'strict'
      ? {}
      : {
          BETTER_AUTH_SECRET: 'local-dev-secret-change-me-minimum-32-chars',
          BETTER_AUTH_URL: 'http://localhost:3071'
        }
  // Pick only schema keys from the source (worker envs also carry bindings)
  // and let the schema validate — the field list lives in ONE place above.
  const picked = Object.fromEntries(
    serverEnvKeys.map((key) => [key, source[key] ?? localDefaults[key]])
  )
  return Schema.decodeUnknownSync(ServerEnvSchema)(picked)
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

  // The AI provider activates on EITHER Workers AI (flag) or an
  // OpenAI-compatible key (`packages/ai`), so its status is an OR of the two
  // instead of the all-required pattern above. `missing` lists both var names
  // to say "configure one of these" (names only, never values).
  const aiEnvPresent = env.WORKERS_AI_ENABLED === 'true' || hasValue(env.OPENAI_API_KEY)
  const ai: ModuleConfigStatus = {
    moduleId: 'ai',
    configured: aiEnvPresent,
    envPresent: aiEnvPresent,
    missing: aiEnvPresent ? [] : ['WORKERS_AI_ENABLED', 'OPENAI_API_KEY']
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
    status('turnstile', ['TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY']),
    ai
  ]
}

/**
 * The full ADR 0035 recipe for a worker: validate the raw worker env and
 * derive module config status from it. Callers pass their `env` object
 * directly — bindings and other non-schema keys are ignored, so no casts or
 * var-name remaps are needed.
 */
export function makeStarterEnvModuleConfig(
  env: Record<string, unknown>
): readonly ModuleConfigStatus[] {
  return moduleConfigStatus(readServerEnv(env))
}

export function redactedEnvStatus(env: ServerEnv) {
  return moduleConfigStatus(env).map((item) => ({
    ...item,
    values: item.configured ? 'configured' : item.envPresent ? 'env-present' : 'missing'
  }))
}
