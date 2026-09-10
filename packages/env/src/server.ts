import { classifyTrustedOrigin, trustedOriginEntries } from './trusted-origin.ts'

// Single source of truth for server env vars. Add a new var HERE
// (and, when alchemy should forward it to deployed workers, to exactly one of
// the optional-module key lists below) — everything else derives from the
// type: `alchemy.run.ts` builds its forwarding env from the key lists,
// `apps/web/src/worker-env.d.ts` derives its string vars from `ServerEnv`, and
// the provider env bags (`ProviderEnv` in `packages/ai`) `Pick` from it.
//
// A plain type, deliberately: nothing ever decodes an env bag against it
// (there is no reader to decode it), so a schema would be restating the type
// with runtime machinery this package never runs.
//
// This package is a TYPE source and a pair of pure decisions
// (`auditRequiredEnv`, `requireEmailVerification`). It deliberately owns no
// reader: workers read `cloudflareEnv.X` directly, which is what keeps an
// unset provider var inactive instead of a boot failure.
//
// Optional keys are `?: string | undefined` on purpose: the repo runs with
// `exactOptionalPropertyTypes`, and a worker env bag hands over `undefined`
// for an unset var.
export type ServerEnv = {
  readonly BETTER_AUTH_SECRET: string
  readonly BETTER_AUTH_URL: string
  readonly BETTER_AUTH_TRUSTED_ORIGINS?: string | undefined
  readonly STRIPE_SECRET_KEY?: string | undefined
  readonly STRIPE_WEBHOOK_SECRET?: string | undefined
  readonly STRIPE_PRICE_ID_TEAM?: string | undefined
  readonly STRIPE_PRICE_ID_ENTERPRISE?: string | undefined
  readonly SENTRY_DSN?: string | undefined
  /** Append-only recovery evidence store outside the production Cloudflare account. */
  readonly SECURITY_EVIDENCE_URL?: string | undefined
  /** Bearer credential for the independent recovery evidence store. */
  readonly SECURITY_EVIDENCE_TOKEN?: string | undefined
  readonly POSTHOG_KEY?: string | undefined
  readonly POSTHOG_HOST?: string | undefined
  readonly CLOUDFLARE_EMAIL_FROM?: string | undefined
  readonly TURNSTILE_SITE_KEY?: string | undefined
  readonly TURNSTILE_SECRET_KEY?: string | undefined
  readonly WORKERS_AI_ENABLED?: string | undefined
  readonly OPENAI_API_KEY?: string | undefined
  readonly OPENAI_BASE_URL?: string | undefined
  readonly OPENAI_MODEL_ID?: string | undefined
  readonly GITHUB_CLIENT_ID?: string | undefined
  readonly GITHUB_CLIENT_SECRET?: string | undefined
  readonly GOOGLE_CLIENT_ID?: string | undefined
  readonly GOOGLE_CLIENT_SECRET?: string | undefined
  readonly OTEL_EXPORTER_OTLP_ENDPOINT?: string | undefined
  readonly OTEL_EXPORTER_OTLP_HEADERS?: string | undefined
  // MCP OAuth (ADR 0068): the API worker's `/mcp` URL that access tokens are
  // audience-bound to, and the web worker's Better Auth base URL the API worker
  // trusts as token issuer. Unset on the API worker, `/mcp` accepts API Tokens
  // only; unset on the web worker, the resource defaults to the local API dev
  // server so the consent flow keeps working provider-light.
  readonly MCP_RESOURCE_URL?: string | undefined
  readonly MCP_OAUTH_ISSUER?: string | undefined
  readonly SERVICE_VERSION?: string | undefined
  readonly GIT_COMMIT_SHA?: string | undefined
  readonly ENVIRONMENT?: string | undefined
  /** Pauses customer traffic and business processing during recovery. */
  readonly MAINTENANCE_MODE?: string | undefined
  // Workspace data export (ADR 0055). `WORKSPACE_EXPORTS_ENABLED` is a
  // deploy-time switch only — alchemy provisions the export bucket and queue
  // when it is `true`, and names the bucket from the stage
  // (`infra/bindings.ts`), never from this value. It is deliberately NOT the
  // binding name: `WORKSPACE_EXPORT_BUCKET` is the R2 `Bucket` a worker reads,
  // and a string var of that name would collide with it in every worker env
  // type. `API_PUBLIC_URL` is the API worker's public origin, where the web
  // app points signed download links.
  readonly WORKSPACE_EXPORTS_ENABLED?: string | undefined
  readonly API_PUBLIC_URL?: string | undefined
  readonly SUPPORT_EMAIL?: string | undefined
  readonly SUPPORT_HELPDESK_URL?: string | undefined
  readonly SUPPORT_HELP_CENTER_URL?: string | undefined
  /** Retention is preview-only unless recovery and operator approval are set. */
  readonly RETENTION_CLEANUP_ENABLED?: string | undefined
  readonly RETENTION_RECOVERY_VERIFIED?: string | undefined
  readonly RETENTION_AUDIT_DAYS?: string | undefined
  readonly RETENTION_NOTIFICATION_DAYS?: string | undefined
  readonly RETENTION_INVITATION_DAYS?: string | undefined
  readonly RETENTION_TOKEN_DAYS?: string | undefined
  readonly RETENTION_EXPORT_DAYS?: string | undefined
  readonly RETENTION_BILLING_DAYS?: string | undefined
  readonly RETENTION_EMAIL_DAYS?: string | undefined
  readonly RETENTION_UNRESOLVED_EMAIL_DAYS?: string | undefined
  readonly RETENTION_BATCH_SIZE?: string | undefined
  readonly RETENTION_WORK_BUDGET?: string | undefined
  readonly RETENTION_POLICY_APPROVAL_DIGEST?: string | undefined
  readonly RETENTION_PREVIEW_DIGEST?: string | undefined
  readonly RETENTION_RECOVERY_EVIDENCE?: string | undefined
  readonly RETENTION_POLICY_VERSION?: string | undefined
  readonly RETENTION_POLICY_TARGET?: string | undefined
  /** Deployment-derived target. Operators cannot override this binding. */
  readonly RETENTION_DATABASE_TARGET?: string | undefined
}

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
// `satisfies` pins both lists to the `ServerEnv` type's keys, so a typo or a
// var that was removed from the type is a compile error.
// oxlint-disable-next-line effect/noAs -- `as const`, not a type assertion
export const optionalModuleEnvSecretKeys = [
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'TURNSTILE_SECRET_KEY',
  'OPENAI_API_KEY',
  'GITHUB_CLIENT_SECRET',
  'GOOGLE_CLIENT_SECRET',
  'SECURITY_EVIDENCE_TOKEN',
  'OTEL_EXPORTER_OTLP_HEADERS'
] as const satisfies ReadonlyArray<keyof ServerEnv>

// oxlint-disable-next-line effect/noAs -- `as const`, not a type assertion
export const optionalModuleEnvPlainKeys = [
  'SENTRY_DSN',
  'SECURITY_EVIDENCE_URL',
  'POSTHOG_KEY',
  'POSTHOG_HOST',
  'STRIPE_PRICE_ID_TEAM',
  'STRIPE_PRICE_ID_ENTERPRISE',
  'TURNSTILE_SITE_KEY',
  'CLOUDFLARE_EMAIL_FROM',
  'WORKERS_AI_ENABLED',
  'OPENAI_BASE_URL',
  'OPENAI_MODEL_ID',
  'GITHUB_CLIENT_ID',
  'GOOGLE_CLIENT_ID',
  'OTEL_EXPORTER_OTLP_ENDPOINT',
  'MCP_RESOURCE_URL',
  'MCP_OAUTH_ISSUER',
  'SERVICE_VERSION',
  'GIT_COMMIT_SHA',
  'ENVIRONMENT',
  'MAINTENANCE_MODE',
  'API_PUBLIC_URL',
  'SUPPORT_EMAIL',
  'SUPPORT_HELPDESK_URL',
  'SUPPORT_HELP_CENTER_URL',
  'RETENTION_CLEANUP_ENABLED',
  'RETENTION_RECOVERY_VERIFIED',
  'RETENTION_AUDIT_DAYS',
  'RETENTION_NOTIFICATION_DAYS',
  'RETENTION_INVITATION_DAYS',
  'RETENTION_TOKEN_DAYS',
  'RETENTION_EXPORT_DAYS',
  'RETENTION_BILLING_DAYS',
  'RETENTION_EMAIL_DAYS',
  'RETENTION_UNRESOLVED_EMAIL_DAYS',
  'RETENTION_BATCH_SIZE',
  'RETENTION_WORK_BUDGET',
  'RETENTION_POLICY_APPROVAL_DIGEST',
  'RETENTION_PREVIEW_DIGEST',
  'RETENTION_RECOVERY_EVIDENCE',
  'RETENTION_POLICY_VERSION',
  'RETENTION_POLICY_TARGET'
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

/** Whether an operator has put the deployment into system-wide maintenance. */
export function isMaintenanceMode(value: string | null | undefined): boolean {
  return value?.trim().toLowerCase() === 'true'
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
 * legitimately boots on these (the dev/test workers shim supplies one, and
 * `.env.example` hands out another), so they are rejected by value, not by
 * absence: a copied-from-dev secret is exactly the deployment mistake this
 * audit exists to catch. Better Auth's own fallback is listed so a worker
 * that somehow reaches it is flagged too.
 */
const PLACEHOLDER_AUTH_SECRETS: ReadonlySet<string> = new Set([
  'local-dev-secret-change-me-minimum-32-chars',
  'local-dev-secret',
  'better-auth-secret-12345678901234567890',
  // The shipped `.env.example` value: 45 chars, so only value rejection —
  // never the length check — catches a local `.env` copied wholesale to a
  // deploy.
  'dev-only-secret-3f8a1c9e57b24d6f8e0a4c7b9d2f16e8'
])

/** The documented placeholder URL and its obvious variants. */
function isPlaceholderAuthUrl(value: string): boolean {
  if (value === 'https://b2b-saas-starter.example.com') {
    return true
  }
  // An unparsable value has no hostname, and `''` matches neither check.
  const hostname = URL.parse(value)?.hostname ?? ''
  return hostname === 'localhost' || hostname.endsWith('.example.com')
}

/**
 * Whether `BETTER_AUTH_URL` carries the `https:` scheme. Better Auth derives
 * cookie `Secure` flags and every emailed link from this URL, so a production
 * deploy on plain `http:` would mint cookies any network hop can read. A
 * value that does not parse as a URL at all is not `https:` either.
 */
function isHttpsAuthUrl(value: string): boolean {
  return URL.parse(value)?.protocol === 'https:'
}

export type RequiredEnvProblem = {
  readonly key: 'BETTER_AUTH_SECRET' | 'BETTER_AUTH_URL' | 'BETTER_AUTH_TRUSTED_ORIGINS'
  readonly reason: 'missing' | 'placeholder' | 'too-short' | 'malformed' | 'insecure'
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

/** The social sign-in providers the starter knows how to wire. */
export { SOCIAL_PROVIDER_IDS, type SocialProviderId } from './social.ts'

/** One configured social provider — present only when both halves are set. */
export type SocialProviderCredentials = {
  readonly clientId: string
  readonly clientSecret: string
}

/**
 * The providers that are active for one env bag. Keys are stated explicitly
 * (never `Partial<Record<…>>`): which providers exist is a closed set this
 * type owns, and a caller reading `providers.github` learns `undefined`
 * means unconfigured — not "some provider key we don't know about". A key is
 * present only when the provider resolved as active.
 */
export type ActiveSocialProviders = {
  readonly github?: SocialProviderCredentials
  readonly google?: SocialProviderCredentials
}

/**
 * The pure decision of which social providers are active: a provider counts
 * only when **both** its `*_CLIENT_ID` and `*_CLIENT_SECRET` have a value
 * ({@link hasValue}), so an unset — or explicitly null — var means the
 * provider is absent from the auth config entirely, never half-configured.
 * The caller passes the resolved bag to `AuthConfig.socialProviders`
 * (`packages/auth`), which never reads env itself.
 */
export function activeSocialProviders(source: RawEnvSource): ActiveSocialProviders {
  return {
    ...(hasValue(source.GITHUB_CLIENT_ID) &&
      hasValue(source.GITHUB_CLIENT_SECRET) && {
        github: {
          clientId: source.GITHUB_CLIENT_ID,
          clientSecret: source.GITHUB_CLIENT_SECRET
        }
      }),
    ...(hasValue(source.GOOGLE_CLIENT_ID) &&
      hasValue(source.GOOGLE_CLIENT_SECRET) && {
        google: {
          clientId: source.GOOGLE_CLIENT_ID,
          clientSecret: source.GOOGLE_CLIENT_SECRET
        }
      })
  }
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
 * Audit of the required baseline vars, for a worker that consumes them
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
  } else if (mode === 'production' && !isHttpsAuthUrl(url)) {
    // The scheme is a production-only verdict: local dev and preview stages
    // legitimately run on http (`localhost`), and their audits are silent or
    // warn-only anyway. In production the URL stamps the auth cookies and
    // every emailed link, so `http:` — or a value that does not parse as a
    // URL — is refused.
    problems.push({ key: 'BETTER_AUTH_URL', reason: 'insecure' })
  }

  // A malformed trusted origin silently weakens Better Auth's origin checks —
  // `https:/app.example.com` matches nothing, so the intended origin loses its
  // CSRF carve-out. Flag any entry that does not parse as an http(s) URL.
  const trustedOrigins = source.BETTER_AUTH_TRUSTED_ORIGINS ?? undefined
  if (trustedOrigins !== undefined && trustedOrigins.length > 0) {
    for (const origin of trustedOriginEntries(trustedOrigins)) {
      const kind = classifyTrustedOrigin(origin)
      if (kind === 'malformed') {
        problems.push({
          key: 'BETTER_AUTH_TRUSTED_ORIGINS',
          reason: 'malformed'
        })
      }
      // An origin with userinfo parses fine, so it would otherwise pass this
      // audit while `auditSecureEndpoints` refuses it — and it puts a
      // credential in a config string either way.
      if (kind === 'credentialed') {
        problems.push({
          key: 'BETTER_AUTH_TRUSTED_ORIGINS',
          reason: 'insecure'
        })
      }
    }
  }

  return { mode, problems }
}
