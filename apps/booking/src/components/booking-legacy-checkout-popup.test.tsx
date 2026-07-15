// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BookingLegacyCheckoutPopup } from './booking-legacy-checkout-popup.tsx'

afterEach(cleanup)

describe('BookingLegacyCheckoutPopup', () => {
  it('matches the cancellable legacy policy anatomy', () => {
    render(
      <BookingLegacyCheckoutPopup
        open
        target={document.body}
        phase="policies"
        onClose={vi.fn()}
        onPolicyComplete={vi.fn()}
        cancellation={{
          eligible: true,
          cancellableUntil: '2026-07-16T13:00:00.000Z',
          timeZone: 'Europe/Bucharest',
          locale: 'en'
        }}
        copy={{
          cancellationPolicy: 'Cancellation policy',
          cancellationPolicyCopy:
            'You’ll have until {time} on {date} to cancel this appointment without being charged.',
          noCancellation: 'This appointment cannot be cancelled.',
          now: 'Now',
          appointment: 'Appointment',
          confirmBooking: 'Confirm booking',
          agree: 'I agree',
          close: 'Close'
        }}
      >
        <div />
      </BookingLegacyCheckoutPopup>
    )

    const policy = screen.getByRole('dialog', { name: 'Cancellation policy' })
    expect(within(policy).getByTestId('policy:tooltip')).toBeTruthy()
    expect(within(policy).getByTestId('policy:cancellation-bar')).toBeTruthy()
    expect(within(policy).getByTestId('text:cancellationTime')).toBeTruthy()
    expect(within(policy).getByTestId('text:cancellationDate')).toBeTruthy()
    expect(within(policy).getByTestId('btn:confirm').textContent).toBe('I agree')
  })
})
