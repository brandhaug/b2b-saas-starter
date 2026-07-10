// Test/build stand-in for the Merchant App's Worker bindings. Development
// replaces this with the persisted-local-D1 variant beside it.
export const env = {
  DB: undefined,
  MERCHANT_AUTH_SECRET:
    process.env.MERCHANT_AUTH_SECRET ??
    'local-merchant-auth-secret-change-me-minimum-32-chars',
  MERCHANT_AUTH_URL: process.env.MERCHANT_AUTH_URL ?? 'http://localhost:3072',
  MERCHANT_AUTH_TRUSTED_ORIGINS:
    process.env.MERCHANT_AUTH_TRUSTED_ORIGINS ?? 'http://localhost:3072',
  CLOUDFLARE_EMAIL_FROM: process.env.CLOUDFLARE_EMAIL_FROM,
  ENVIRONMENT: process.env.ENVIRONMENT,
  RATE_LIMITER_AUTH_READ: undefined,
  RATE_LIMITER_AUTH_WRITE: undefined
}
