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
  readonly BOOKING_EVENTS_QUEUE?: Queue<
    import('@b2b-saas-starter/capabilities/notifications').BookingEventsWakeup
  >
  readonly CONFIRMATION_SIGNING_KEYS: string
  readonly CONFIRMATION_CURRENT_KEY_ID: string
  readonly OPERATIONAL_MESSAGING_DESTINATION_ENCRYPTION_KEY?: string
  readonly OPERATIONAL_MESSAGING_DESTINATION_FINGERPRINT_KEY?: string
  readonly OPERATIONAL_MESSAGING_DESTINATION_KEY_VERSION?: string
}

declare namespace Cloudflare {
  interface Env extends BookingWorkerEnv {}
}

interface Env extends BookingWorkerEnv {}
