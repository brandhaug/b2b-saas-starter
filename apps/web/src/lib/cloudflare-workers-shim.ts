// Local-dev stand-in for the `cloudflare:workers` module (aliased in
// vite.config.ts when B2B_STARTER_USE_WORKERS_SHIM=1 or in vitest).
// `DB` is intentionally undefined: consumers (capabilities.ts,
// server-context.ts) treat a missing binding as "run provider-light" —
// the capabilities layer falls back to the in-memory Seed layer, and
// auth surfaces a descriptive error only if a query actually executes.
export const env = {
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? 'local-dev-secret',
  BETTER_AUTH_URL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3071',
  BETTER_AUTH_TRUSTED_ORIGINS:
    process.env.BETTER_AUTH_TRUSTED_ORIGINS ?? 'http://localhost:3071',
  GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID,
  GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET,
  // Optional module env (ADR 0035): passed through so local dev derives the
  // same needs-config module statuses as a deployed worker would.
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
  SENTRY_DSN: process.env.SENTRY_DSN,
  POSTHOG_KEY: process.env.POSTHOG_KEY,
  POSTHOG_HOST: process.env.POSTHOG_HOST,
  CLOUDFLARE_EMAIL_FROM: process.env.CLOUDFLARE_EMAIL_FROM,
  TURNSTILE_SITE_KEY: process.env.TURNSTILE_SITE_KEY,
  TURNSTILE_SECRET_KEY: process.env.TURNSTILE_SECRET_KEY,
  DB: undefined
}
