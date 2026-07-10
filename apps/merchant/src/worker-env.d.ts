interface MerchantWorkerEnv {
  readonly DB: D1Database
  readonly EMAIL?: import('./lib/merchant-email.ts').MerchantEmailBinding
  readonly CLOUDFLARE_EMAIL_FROM?: string
  readonly ENVIRONMENT?: string
  readonly MERCHANT_AUTH_SECRET?: string
  readonly MERCHANT_AUTH_URL?: string
  readonly MERCHANT_AUTH_TRUSTED_ORIGINS?: string
  readonly RATE_LIMITER_AUTH_READ?: import('@b2b-saas-starter/rate-limit').CloudflareRateLimit
  readonly RATE_LIMITER_AUTH_WRITE?: import('@b2b-saas-starter/rate-limit').CloudflareRateLimit
}

declare namespace Cloudflare {
  interface Env extends MerchantWorkerEnv {}
}

interface Env extends MerchantWorkerEnv {}
