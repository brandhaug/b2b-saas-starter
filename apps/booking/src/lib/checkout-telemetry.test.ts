import { describe, expect, it, vi } from 'vitest'
import {
  createCheckoutTelemetry,
  resolveBookingConsentPolicy
} from './checkout-telemetry.ts'

describe('Checkout telemetry', () => {
  it('defaults to no-op and gates each optional provider by resolved consent', async () => {
    const send = vi.fn().mockRejectedValue(new Error('analytics down'))
    const report = vi.fn().mockRejectedValue(new Error('monitoring down'))
    let consent = resolveBookingConsentPolicy([])
    const telemetry = createCheckoutTelemetry({
      consent: () => consent,
      analytics: { send },
      errors: { report }
    })
    await telemetry.track('checkout_reviewed')
    await telemetry.report(new Error('command failed'))
    expect(send).not.toHaveBeenCalled()
    expect(report).not.toHaveBeenCalled()

    consent = resolveBookingConsentPolicy(['measurement', 'error_reporting'])
    await expect(telemetry.track('checkout_reviewed')).resolves.toBeUndefined()
    await expect(telemetry.report(new Error('command failed'))).resolves.toBeUndefined()
    expect(send).toHaveBeenCalledWith({ name: 'checkout_reviewed' })
    expect(report).toHaveBeenCalledOnce()
  })
})
