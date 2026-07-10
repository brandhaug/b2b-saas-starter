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
}

declare namespace Cloudflare {
  interface Env extends BookingWorkerEnv {}
}

interface Env extends BookingWorkerEnv {}
