import { Record, Schema } from 'effect'

const optional = Schema.optional(Schema.String)

// Single source of truth for server env vars. Add a new var HERE
// (and, when alchemy should forward it to deployed workers, to exactly one of
// the optional-module key lists below) — everything else derives from the
// schema: `readServerEnv` picks these keys, `alchemy.run.ts` builds its
// forwarding env from the key lists, and `apps/web/src/worker-env.d.ts`
// derives its string vars from `ServerEnv`.
export const ServerEnvSchema = Schema.Struct({
  BETTER_AUTH_SECRET: Schema.String,
  BETTER_AUTH_URL: Schema.String,
  BETTER_AUTH_TRUSTED_ORIGINS: optional,
  STRIPE_SECRET_KEY: optional,
  STRIPE_WEBHOOK_SECRET: optional,
  STRIPE_PRICE_ID_TEAM: optional,
  SENTRY_DSN: optional,
  POSTHOG_KEY: optional,
  POSTHOG_HOST: optional,
  CLOUDFLARE_EMAIL_FROM: optional,
  TURNSTILE_SITE_KEY: optional,
  TURNSTILE_SECRET_KEY: optional,
  WORKERS_AI_ENABLED: optional,
  OPENAI_API_KEY: optional,
  OPENAI_BASE_URL: optional,
  OPENAI_MODEL_ID: optional,
  OTEL_EXPORTER_OTLP_ENDPOINT: optional,
  OTEL_EXPORTER_OTLP_HEADERS: optional,
  SERVICE_VERSION: optional,
  GIT_COMMIT_SHA: optional,
  ENVIRONMENT: optional
})

export type ServerEnv = typeof ServerEnvSchema.Type

/** Compiled once at module scope — `readServerEnv` runs per worker invocation. */
const decodeServerEnv = Schema.decodeUnknownSync(ServerEnvSchema)

/** Every env var the schema declares — derived from the schema, never hand-mirrored. */
export const serverEnvKeys: ReadonlyArray<keyof ServerEnv> = Record.keys(
  ServerEnvSchema.fields
)

// Optional provider env forwarded by alchemy to all three workers. Secret keys
// are wrapped in `Redacted` at deploy time; plain keys are forwarded as-is.
// `satisfies` pins both lists to schema keys, so a typo or a var that was
// removed from the schema is a compile error.
// oxlint-disable-next-line effect/noAs -- `as const`, not a type assertion
export const optionalModuleEnvSecretKeys = [
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'TURNSTILE_SECRET_KEY',
  'OPENAI_API_KEY',
  'OTEL_EXPORTER_OTLP_HEADERS'
] as const satisfies ReadonlyArray<keyof ServerEnv>

// oxlint-disable-next-line effect/noAs -- `as const`, not a type assertion
export const optionalModuleEnvPlainKeys = [
  'SENTRY_DSN',
  'POSTHOG_KEY',
  'POSTHOG_HOST',
  'STRIPE_PRICE_ID_TEAM',
  'TURNSTILE_SITE_KEY',
  'CLOUDFLARE_EMAIL_FROM',
  'WORKERS_AI_ENABLED',
  'OPENAI_BASE_URL',
  'OPENAI_MODEL_ID',
  'OTEL_EXPORTER_OTLP_ENDPOINT',
  'SERVICE_VERSION',
  'GIT_COMMIT_SHA',
  'ENVIRONMENT'
] as const satisfies ReadonlyArray<keyof ServerEnv>

export const optionalModuleEnvKeys: ReadonlyArray<keyof ServerEnv> = [
  ...optionalModuleEnvSecretKeys,
  ...optionalModuleEnvPlainKeys
]

function hasValue(value: string | undefined): boolean {
  return value !== undefined && value.length > 0
}

/**
 * The raw env bag handed to a worker, as far as this boundary is concerned:
 * every schema var may be absent. Bindings (D1, queues, rate limiters) ride
 * along on the same object and are simply extra properties here — they are
 * never read, and every value that is read goes through the schema below.
 */
export type RawEnvSource = Partial<ServerEnv>

/**
 * Local development stays provider-light: the Local Auth Path works with no
 * configured env at all. `strict` mode drops the defaults so a deployed worker
 * fails validation instead of silently booting on a development secret.
 */
function localDefaultsFor(mode: 'local' | 'strict'): Partial<ServerEnv> {
  if (mode === 'strict') return {}
  return {
    BETTER_AUTH_SECRET: 'local-dev-secret-change-me-minimum-32-chars',
    BETTER_AUTH_URL: 'http://localhost:3071'
  }
}

export function readServerEnv(
  source: RawEnvSource,
  options?: { readonly mode?: 'local' | 'strict' }
): ServerEnv {
  const localDefaults = localDefaultsFor(options?.mode ?? 'local')
  // Pick only schema keys from the source (worker envs also carry bindings)
  // and let the schema validate — the field list lives in ONE place above.
  const picked = Object.fromEntries(
    serverEnvKeys.map((key) => [key, source[key] ?? localDefaults[key]])
  )
  return decodeServerEnv(picked)
}

/**
 * Values that must never authenticate a deployed worker. Local development
 * legitimately boots on these (the local-mode defaults and the test/dev
 * workers shim supply them), so they are rejected by value, not by absence:
 * a copied-from-dev secret is exactly the deployment mistake this audit
 * exists to catch. Better Auth's own fallback is listed so a worker that
 * somehow reaches it is flagged too.
 */
const PLACEHOLDER_AUTH_SECRETS: ReadonlySet<string> = new Set([
  'local-dev-secret-change-me-minimum-32-chars',
  'local-dev-secret',
  'better-auth-secret-12345678901234567890'
])

/** The documented placeholder URL and its obvious variants. */
function isPlaceholderAuthUrl(value: string): boolean {
  if (value === 'https://b2b-saas-starter.example.com') return true
  // oxlint-disable-next-line effect/noTryCatch -- `new URL` throws on a malformed value and "not a URL" is the answer, not a failure to handle; there is no Effect context here to lift it into
  try {
    const { hostname } = new URL(value)
    return hostname === 'localhost' || hostname.endsWith('.example.com')
  } catch {
    return false
  }
}

export type RequiredEnvProblem = {
  readonly key: 'BETTER_AUTH_SECRET' | 'BETTER_AUTH_URL'
  readonly reason: 'missing' | 'placeholder' | 'too-short'
}

export type RequiredEnvAudit = {
  /** `local` — ENVIRONMENT unset (dev/test); `deployed` — set, not production. */
  readonly mode: 'local' | 'deployed' | 'production'
  readonly problems: readonly RequiredEnvProblem[]
}

/**
 * The pure decision for Better Auth's `requireEmailVerification`: on only when
 * `ENVIRONMENT` is exactly `production`. Local dev sends lifecycle emails to
 * the log, where nobody could read a gating verification link, so the gate
 * stays off everywhere else — the provider-light rule (see the auth package).
 */
export function requireEmailVerification(environment: string | undefined): boolean {
  return environment === 'production'
}

function requiredEnvMode(source: RawEnvSource): RequiredEnvAudit['mode'] {
  if (source.ENVIRONMENT === 'production') return 'production'
  if (hasValue(source.ENVIRONMENT)) return 'deployed'
  return 'local'
}

/**
 * Audit of the two required baseline vars, for a worker that consumes them
 * (the web worker — auth's only consumer). `ENVIRONMENT` decides the stance:
 * unset means local development, where the local-mode defaults are expected
 * and the audit stays silent. A deployment that bypasses alchemy should set
 * `ENVIRONMENT` or it is treated as local.
 */
export function auditRequiredEnv(source: RawEnvSource): RequiredEnvAudit {
  const mode = requiredEnvMode(source)
  if (mode === 'local') return { mode, problems: [] }

  const problems: Array<RequiredEnvProblem> = []
  const secret = source.BETTER_AUTH_SECRET
  if (secret === undefined || secret.length === 0) {
    problems.push({ key: 'BETTER_AUTH_SECRET', reason: 'missing' })
  } else if (PLACEHOLDER_AUTH_SECRETS.has(secret)) {
    problems.push({ key: 'BETTER_AUTH_SECRET', reason: 'placeholder' })
  } else if (secret.length < 32) {
    problems.push({ key: 'BETTER_AUTH_SECRET', reason: 'too-short' })
  }

  const url = source.BETTER_AUTH_URL
  if (url === undefined || url.length === 0) {
    problems.push({ key: 'BETTER_AUTH_URL', reason: 'missing' })
  } else if (isPlaceholderAuthUrl(url)) {
    problems.push({ key: 'BETTER_AUTH_URL', reason: 'placeholder' })
  }

  return { mode, problems }
}
