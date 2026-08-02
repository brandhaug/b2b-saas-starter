interface MerchantWorkerEnv {
  readonly DB: D1Database
  readonly EMAIL?: import('./lib/merchant-email.ts').MerchantEmailBinding
  readonly CLOUDFLARE_EMAIL_FROM?: string
  readonly TRANSACTIONAL_EMAIL_SENDER_VERIFIED?: string
  readonly TRANSACTIONAL_EMAIL_CALLBACK_SECRET?: string
  readonly TRANSACTIONAL_EMAIL_DISABLED?: string
  readonly ENVIRONMENT?: string
  readonly MERCHANT_AUTH_SECRET?: string
  readonly MERCHANT_AUTH_URL?: string
  readonly MERCHANT_AUTH_TRUSTED_ORIGINS?: string
  readonly OPERATIONS_APP_ORIGIN?: string
  readonly OPERATIONS_SECURITY_CONTACT?: string
  readonly OPERATIONS_RATE_LIMIT_HANDOFF_EXCHANGE?: string
  readonly OPERATIONS_RATE_LIMIT_WINDOW_SECONDS?: string
  readonly PLATFORM_API_CURSOR_SECRET?: string
  readonly PUBLIC_SITE_ORIGIN?: string
  readonly RATE_LIMITER_AUTH_READ?: import('@b2b-saas-starter/rate-limit').CloudflareRateLimit
  readonly RATE_LIMITER_AUTH_WRITE?: import('@b2b-saas-starter/rate-limit').CloudflareRateLimit
  readonly RATE_LIMITER_OPERATIONS_HANDOFF_EXCHANGE?: import('@b2b-saas-starter/rate-limit').CloudflareRateLimit
}

declare namespace Cloudflare {
  interface Env extends MerchantWorkerEnv {}
}

interface Env extends MerchantWorkerEnv {}
