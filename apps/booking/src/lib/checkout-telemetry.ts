export type CheckoutFunnelEventName =
  | 'customer_details_submitted'
  | 'policy_accepted'
  | 'checkout_reviewed'

export type BookingConsentPolicy = {
  readonly measurement: boolean
  readonly errorReporting: boolean
}

export const resolveBookingConsentPolicy = (
  categories: readonly string[] = []
): BookingConsentPolicy => ({
  measurement: categories.includes('measurement'),
  errorReporting: categories.includes('error_reporting')
})

export const createCheckoutTelemetry = (
  input: {
    readonly consent?: () => BookingConsentPolicy
    readonly analytics?: {
      readonly send: (event: {
        readonly name: CheckoutFunnelEventName
      }) => Promise<void>
    }
    readonly errors?: { readonly report: (error: unknown) => Promise<void> }
  } = {}
) => ({
  track: async (name: CheckoutFunnelEventName): Promise<void> => {
    if (!input.analytics || !input.consent?.().measurement) return
    try {
      await input.analytics.send({ name })
    } catch {
      // Booking commands are authoritative; analytics is observational.
    }
  },
  report: async (error: unknown): Promise<void> => {
    if (!input.errors || !input.consent?.().errorReporting) return
    try {
      await input.errors.report(error)
    } catch {
      // Optional monitoring cannot replace or mask the command result.
    }
  }
})

export type CheckoutTelemetry = ReturnType<typeof createCheckoutTelemetry>
export const noOpCheckoutTelemetry = createCheckoutTelemetry()
