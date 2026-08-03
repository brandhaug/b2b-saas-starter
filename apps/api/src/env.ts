import type { BookingProductEnv } from '@b2b-saas-starter/capabilities/runtime'
import type { RateLimitBindings } from './rate-limit.ts'

// The worker's Cloudflare bindings + redacted env. Shared by the handler
// layers, the web-handler assembly, and the fetch entrypoint.
export type ApiEnv = RateLimitBindings & {
  readonly DB?: D1Database
  readonly EMAIL?: {
    readonly send: (message: {
      readonly from: string
      readonly to: string | readonly string[]
      readonly subject: string
      readonly text?: string
      readonly html?: string
      readonly headers?: Readonly<Record<string, string>>
    }) => Promise<unknown>
  }
  readonly PLATFORM_API_CURSOR_SECRET?: string
  readonly ENVIRONMENT?: string
  readonly BOOKING_EVENTS_QUEUE?: Queue
  readonly META_WHATSAPP_APP_SECRET?: string
  readonly META_WHATSAPP_WEBHOOK_VERIFY_TOKEN?: string
  readonly META_WHATSAPP_PROVIDER_ACCOUNT_KEY?: string
  readonly META_WHATSAPP_REFERENCE_FINGERPRINT_KEY?: string
  readonly SMSO_CALLBACK_PATH_SECRET?: string
  readonly SMSO_PROVIDER_REFERENCE_FINGERPRINT_KEY?: string
  readonly CLOUDFLARE_EMAIL_FROM?: string
  readonly TRANSACTIONAL_EMAIL_SENDER_VERIFIED?: string
  readonly TRANSACTIONAL_EMAIL_CALLBACK_SECRET?: string
  readonly TRANSACTIONAL_EMAIL_PROVIDER_REFERENCE_FINGERPRINT_KEY?: string
  readonly STRIPE_SUBSCRIPTION_WEBHOOK_SECRET?: string
  readonly STRIPE_SUBSCRIPTION_SECRET_KEY?: string
  readonly STRIPE_SOLO_MONTHLY_PRICE_ID?: string
  readonly STRIPE_SOLO_ANNUAL_PRICE_ID?: string
}

// Module-aware env validation (ADR 0035): derive module config status from
// this worker's real env so REST module/integration status reflects the
// deployment instead of stored fixture state.
export const bookingProductEnv = (env: ApiEnv): BookingProductEnv => {
  if (!env.DB) throw new Error('The Booking Product API requires its D1 binding.')
  return {
    DB: env.DB,
    EMAIL: env.EMAIL,
    CLOUDFLARE_EMAIL_FROM: env.CLOUDFLARE_EMAIL_FROM,
    TRANSACTIONAL_EMAIL_SENDER_VERIFIED: env.TRANSACTIONAL_EMAIL_SENDER_VERIFIED,
    TRANSACTIONAL_EMAIL_CALLBACK_SECRET: env.TRANSACTIONAL_EMAIL_CALLBACK_SECRET,
    TRANSACTIONAL_EMAIL_PROVIDER_REFERENCE_FINGERPRINT_KEY:
      env.TRANSACTIONAL_EMAIL_PROVIDER_REFERENCE_FINGERPRINT_KEY,
    BOOKING_EVENTS_QUEUE: env.BOOKING_EVENTS_QUEUE,
    PLATFORM_API_CURSOR_SECRET: env.PLATFORM_API_CURSOR_SECRET,
    REQUIRE_PLATFORM_API_CURSOR_SECRET: env.ENVIRONMENT === 'production'
  }
}
