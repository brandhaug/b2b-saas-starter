interface MerchantWorkerEnv {
  readonly DB: D1Database
  readonly EMAIL?: import('./lib/merchant-email.ts').MerchantEmailBinding
  readonly CLOUDFLARE_EMAIL_FROM?: string
  readonly TRANSACTIONAL_EMAIL_SENDER_VERIFIED?: string
  readonly TRANSACTIONAL_EMAIL_CALLBACK_SECRET?: string
  readonly TRANSACTIONAL_EMAIL_PROVIDER_REFERENCE_FINGERPRINT_KEY?: string
  readonly TRANSACTIONAL_EMAIL_DISABLED?: string
  readonly CONFIRMATION_SIGNING_KEYS?: string
  readonly CONFIRMATION_CURRENT_KEY_ID?: string
  readonly ENVIRONMENT?: string
  readonly MERCHANT_AUTH_SECRET?: string
  readonly MERCHANT_AUTH_URL?: string
  readonly MERCHANT_AUTH_TRUSTED_ORIGINS?: string
  readonly OPERATIONS_APP_ORIGIN?: string
  readonly OPERATIONS_SECURITY_CONTACT?: string
  readonly OPERATIONS_RATE_LIMIT_HANDOFF_EXCHANGE?: string
  readonly OPERATIONS_RATE_LIMIT_WINDOW_SECONDS?: string
  readonly PLATFORM_API_CURSOR_SECRET?: string
  readonly CUSTOMER_DIRECTORY_FINGERPRINT_KEY?: string
  readonly PUBLIC_SITE_ORIGIN?: string
  readonly MERCHANT_APP_ORIGIN?: string
  readonly STRIPE_SUBSCRIPTION_SECRET_KEY?: string
  readonly STRIPE_SOLO_MONTHLY_PRICE_ID?: string
  readonly STRIPE_SOLO_ANNUAL_PRICE_ID?: string
  readonly STRIPE_BILLING_PORTAL_CONFIGURATION_ID?: string
  readonly RATE_LIMITER_AUTH_READ?: import('@b2b-saas-starter/rate-limit').CloudflareRateLimit
  readonly RATE_LIMITER_AUTH_WRITE?: import('@b2b-saas-starter/rate-limit').CloudflareRateLimit
  readonly RATE_LIMITER_OPERATIONS_HANDOFF_EXCHANGE?: import('@b2b-saas-starter/rate-limit').CloudflareRateLimit
}

declare namespace Cloudflare {
  interface Env extends MerchantWorkerEnv {}
}

interface Env extends MerchantWorkerEnv {}
