// Local-dev stand-in for the `cloudflare:workers` module (aliased in
// vite.config.ts when B2B_STARTER_USE_WORKERS_SHIM=1 or in vitest).
// `DB` is intentionally undefined: capability consumers treat a missing
// binding as "run provider-light" and surface a typed degraded state.
export const env = {
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
