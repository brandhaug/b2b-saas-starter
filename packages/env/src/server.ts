import { Schema } from 'effect'

const optional = Schema.optional(Schema.String)

// Single source of truth for server env vars. Add a new var HERE
// (and, when alchemy should forward it to deployed workers, to exactly one of
// the optional-module key lists below) — everything else derives from the
// schema: `alchemy.run.ts` builds its forwarding env from the key lists,
// `apps/web/src/worker-env.d.ts` derives its string vars from `ServerEnv`, and
// the provider env bags (`ProviderEnv` in `packages/ai`) `Pick` from it.
//
// This package is a TYPE source and a pair of pure decisions
// (`auditRequiredEnv`, `requireEmailVerification`). It deliberately owns no
// reader: workers read `cloudflareEnv.X` directly, which is what keeps an
// unset provider var inactive instead of a boot failure.
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

/**
 * A provider module's slice of the server env.
 *
 * Every key is optional *and* explicitly `| undefined`: the repo runs with
 * `exactOptionalPropertyTypes`, so a bare `?:` would forbid passing a key
 * whose value is `undefined` — which is exactly what a worker env bag hands
 * over for an unset var. That constraint is what used to force callers to
 * hand-build a bag key by key instead of passing their env straight through.
 *
 * Pair it with {@link hasValue} for the presence test, so every module answers
 * "is this provider configured" the same way.
 */
export type ProviderEnvOf<K extends keyof ServerEnv> = {
  readonly [P in K]?: ServerEnv[P] | undefined
}

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

/**
 * Absent means "no value". The deploy boundary may deliver `undefined` (var
 * not forwarded) or `null` (a binding explicitly set to null — workerd does
 * this for present-but-null bindings), and both mean the same thing here:
 * the provider is unconfigured. Only a `length > 0` string counts.
 *
 * Exported as the third pure decision of this package (beside
 * {@link auditRequiredEnv} and {@link requireEmailVerification}): "unset means
 * inactive" is the provider-light rule every optional-provider reader applies,
 * and it is one rule, not one per reader. A whitespace-only value counts as
 * set — an operator who configured `" "` configured something, and guessing
 * otherwise would silently disable a provider they asked for.
 */
export function hasValue(value: string | null | undefined): value is string {
  return value !== null && value !== undefined && value.length > 0
}

/**
 * The raw env bag handed to a worker, as far as this boundary is concerned:
 * every schema var may be absent — or explicitly `null` (workerd delivers
 * present-but-null bindings as `null`, and the deploy boundary has shipped
 * that before), which is why every read treats null like absent. Bindings
 * (D1, queues, rate limiters) ride along on the same object and are simply
 * extra properties here — {@link auditRequiredEnv} reads only the baseline
 * vars it names.
 */
export type RawEnvSource = {
  readonly [K in keyof ServerEnv]?: ServerEnv[K] | null
}

/**
 * Values that must never authenticate a deployed worker. Local development
 * legitimately boots on these (the dev/test workers shim supplies one, and the
 * docs hand out the others), so they are rejected by value, not by absence: a
 * copied-from-dev secret is exactly the deployment mistake this audit exists
 * to catch. Better Auth's own fallback is listed so a worker that somehow
 * reaches it is flagged too.
 */
const PLACEHOLDER_AUTH_SECRETS: ReadonlySet<string> = new Set([
  'local-dev-secret-change-me-minimum-32-chars',
  'local-dev-secret',
  'better-auth-secret-12345678901234567890'
])

/** The documented placeholder URL and its obvious variants. */
function isPlaceholderAuthUrl(value: string): boolean {
  if (value === 'https://b2b-saas-starter.example.com') {
    return true
  }
  // oxlint-disable-next-line effect/noTryCatch -- `new URL` throws on a malformed value and "not a URL" is the answer, not a failure to handle; there is no Effect context here to lift it into
  try {
    const { hostname } = new URL(value)
    return hostname === 'localhost' || hostname.endsWith('.example.com')
  } catch {
    return false
  }
}

export type RequiredEnvProblem = {
  readonly key: 'BETTER_AUTH_SECRET' | 'BETTER_AUTH_URL' | 'BETTER_AUTH_TRUSTED_ORIGINS'
  readonly reason: 'missing' | 'placeholder' | 'too-short' | 'malformed'
}

export type RequiredEnvAudit = {
  /** `local` — ENVIRONMENT unset (dev/test); `deployed` — set, not production. */
  readonly mode: 'local' | 'deployed' | 'production'
  readonly problems: ReadonlyArray<RequiredEnvProblem>
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
  if (source.ENVIRONMENT === 'production') {
    return 'production'
  }
  if (hasValue(source.ENVIRONMENT)) {
    return 'deployed'
  }
  return 'local'
}

/**
 * Audit of the two required baseline vars, for a worker that consumes them
 * (the web worker — auth's only consumer). `ENVIRONMENT` decides the stance:
 * unset means local development, where the shim's development values are
 * expected and the audit stays silent. A deployment that bypasses alchemy should set
 * `ENVIRONMENT` or it is treated as local.
 */
export function auditRequiredEnv(source: RawEnvSource): RequiredEnvAudit {
  const mode = requiredEnvMode(source)
  if (mode === 'local') {
    return { mode, problems: [] }
  }

  const problems: Array<RequiredEnvProblem> = []
  // Normalize an explicit null binding to absent (`?? undefined`) — workerd
  // delivers present-but-null bindings as `null`, and the audit must treat
  // that exactly like a missing var.
  const secret = source.BETTER_AUTH_SECRET ?? undefined
  if (secret === undefined || secret.length === 0) {
    problems.push({ key: 'BETTER_AUTH_SECRET', reason: 'missing' })
  } else if (PLACEHOLDER_AUTH_SECRETS.has(secret)) {
    problems.push({ key: 'BETTER_AUTH_SECRET', reason: 'placeholder' })
  } else if (secret.length < 32) {
    problems.push({ key: 'BETTER_AUTH_SECRET', reason: 'too-short' })
  }

  const url = source.BETTER_AUTH_URL ?? undefined
  if (url === undefined || url.length === 0) {
    problems.push({ key: 'BETTER_AUTH_URL', reason: 'missing' })
  } else if (isPlaceholderAuthUrl(url)) {
    problems.push({ key: 'BETTER_AUTH_URL', reason: 'placeholder' })
  }

  // A malformed trusted origin silently weakens Better Auth's origin checks —
  // `https:/app.example.com` matches nothing, so the intended origin loses its
  // CSRF carve-out. Flag any entry that does not parse as an http(s) URL.
  const trustedOrigins = source.BETTER_AUTH_TRUSTED_ORIGINS ?? undefined
  if (trustedOrigins !== undefined && trustedOrigins.length > 0) {
    for (const entry of trustedOrigins.split(',')) {
      const origin = entry.trim()
      let valid = false
      // oxlint-disable-next-line effect/noTryCatch -- `new URL` throws on a malformed value and "not a URL" is the answer, not a failure to handle; there is no Effect context here to lift it into
      try {
        if (origin.startsWith('*.')) {
          // Better Auth's scheme-less wildcard form (`*.example.com`).
          valid = !origin.slice(2).includes('*')
        } else {
          const parsed = new URL(origin)
          valid = parsed.protocol === 'https:' || parsed.protocol === 'http:'
        }
      } catch {
        // A throw IS the answer here: the entry is not a URL, so it stays
        // `valid: false` and is flagged below.
      }
      if (origin.length === 0 || !valid) {
        problems.push({
          key: 'BETTER_AUTH_TRUSTED_ORIGINS',
          reason: 'malformed'
        })
      }
    }
  }

  return { mode, problems }
}
