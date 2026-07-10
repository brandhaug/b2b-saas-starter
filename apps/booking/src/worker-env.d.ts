interface BookingWorkerEnv {
  readonly DB: D1Database
  readonly PUBLIC_SITE_ORIGIN: string
  readonly RATE_LIMITER_BOOKING_READ?: {
    readonly limit: (input: { readonly key: string }) => Promise<{
      readonly success: boolean
    }>
  }
  readonly RATE_LIMITER_BOOKING_WRITE?: {
    readonly limit: (input: { readonly key: string }) => Promise<{
      readonly success: boolean
    }>
  }
  readonly BOOKING_EVENTS_QUEUE?: Queue<{ readonly outboxId: string }>
  readonly CONFIRMATION_SIGNING_KEYS: string
  readonly CONFIRMATION_CURRENT_KEY_ID: string
}

declare namespace Cloudflare {
  interface Env extends BookingWorkerEnv {}
}

interface Env extends BookingWorkerEnv {}
