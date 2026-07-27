// Test/build stand-in for the Operations App's Worker bindings. Development
// replaces this with the persisted-local-D1 variant beside it.
export const env = {
  ENVIRONMENT: process.env.ENVIRONMENT ?? 'development',
  MERCHANT_AUTH_SECRET:
    process.env.MERCHANT_AUTH_SECRET ??
    'local-merchant-auth-secret-change-me-minimum-32-chars',
  MERCHANT_APP_ORIGIN: process.env.MERCHANT_APP_ORIGIN ?? 'http://localhost:3072',
  OPERATIONS_APP_ORIGIN: process.env.OPERATIONS_APP_ORIGIN ?? 'http://localhost:3076',
  OPERATIONS_AUTH_SECRET:
    process.env.OPERATIONS_AUTH_SECRET ??
    'local-operations-auth-secret-change-me-minimum-32-chars',
  OPERATIONS_AUTH_TRUSTED_ORIGINS:
    process.env.OPERATIONS_AUTH_TRUSTED_ORIGINS ??
    'http://localhost:3076,http://hassans-macbook-pro.tail8c0b7c.ts.net:3076',
  OPERATIONS_LOCAL_SEED: process.env.OPERATIONS_LOCAL_SEED ?? 'enabled',
  OPERATIONS_SECURITY_CONTACT:
    process.env.OPERATIONS_SECURITY_CONTACT ?? 'security@operations.local',
  OPERATIONS_RATE_LIMIT_SESSION_READ:
    process.env.OPERATIONS_RATE_LIMIT_SESSION_READ ?? '120',
  OPERATIONS_RATE_LIMIT_AUTHENTICATION:
    process.env.OPERATIONS_RATE_LIMIT_AUTHENTICATION ?? '10',
  OPERATIONS_RATE_LIMIT_TOTP: process.env.OPERATIONS_RATE_LIMIT_TOTP ?? '5',
  OPERATIONS_RATE_LIMIT_SEARCH: process.env.OPERATIONS_RATE_LIMIT_SEARCH ?? '30',
  OPERATIONS_RATE_LIMIT_MANAGEMENT:
    process.env.OPERATIONS_RATE_LIMIT_MANAGEMENT ?? '20',
  OPERATIONS_RATE_LIMIT_IMPERSONATION_START:
    process.env.OPERATIONS_RATE_LIMIT_IMPERSONATION_START ?? '10',
  OPERATIONS_RATE_LIMIT_HANDOFF_EXCHANGE:
    process.env.OPERATIONS_RATE_LIMIT_HANDOFF_EXCHANGE ?? '10',
  OPERATIONS_RATE_LIMIT_WINDOW_SECONDS:
    process.env.OPERATIONS_RATE_LIMIT_WINDOW_SECONDS ?? '60',
  ...(process.env.CLOUDFLARE_EMAIL_FROM
    ? { CLOUDFLARE_EMAIL_FROM: process.env.CLOUDFLARE_EMAIL_FROM }
    : {})
}
