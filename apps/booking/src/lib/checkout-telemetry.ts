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

type CheckoutBrowser = Window & {
  readonly bookingConsentCategories?: () => readonly string[]
  readonly posthog?: { readonly capture?: (name: string) => void }
  readonly Sentry?: { readonly captureException?: (error: unknown) => void }
}

export const createBrowserCheckoutTelemetry = (): CheckoutTelemetry => {
  if (typeof window === 'undefined') return noOpCheckoutTelemetry
  const browser = window as CheckoutBrowser
  const consent = () =>
    resolveBookingConsentPolicy(browser.bookingConsentCategories?.() ?? [])
  if (browser.posthog?.capture && browser.Sentry?.captureException)
    return createCheckoutTelemetry({
      consent,
      analytics: { send: async ({ name }) => browser.posthog?.capture?.(name) },
      errors: {
        report: async (error) => browser.Sentry?.captureException?.(error)
      }
    })
  if (browser.posthog?.capture)
    return createCheckoutTelemetry({
      consent,
      analytics: { send: async ({ name }) => browser.posthog?.capture?.(name) }
    })
  if (browser.Sentry?.captureException)
    return createCheckoutTelemetry({
      consent,
      errors: {
        report: async (error) => browser.Sentry?.captureException?.(error)
      }
    })
  return createCheckoutTelemetry({
    consent
  })
}
