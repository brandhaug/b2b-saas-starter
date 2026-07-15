// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BookingLegacyCheckoutPopup,
  BookingLegacyNotificationPolicies
} from './booking-legacy-checkout-popup.tsx'

afterEach(cleanup)

describe('BookingLegacyCheckoutPopup', () => {
  it('matches the cancellable legacy policy anatomy', () => {
    render(
      <BookingLegacyCheckoutPopup
        open
        target={document.body}
        phase="policies"
        policyKinds={['cancellation']}
        onClose={vi.fn()}
        onPolicyComplete={vi.fn()}
        cancellation={{
          eligible: true,
          cancellableUntil: '2026-07-16T13:00:00.000Z',
          timeZone: 'Europe/Bucharest',
          locale: 'en'
        }}
        checkoutPolicy={{
          version: 4,
          disclosure: 'Cancel up to 24 hours before the appointment.'
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
          close: 'Close',
          policiesLabel: 'Policies',
          policyProgress: 'Policy progress',
          checkoutPolicyVersion: 'Checkout policy version {version}',
          adultsTitle: 'Adults only',
          adultsCopy: 'Guests must be 21 or older.',
          adultsConfirm: 'I am 21 or older'
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
    expect(within(policy).getByText('Checkout policy version 4')).toBeTruthy()
    expect(
      within(policy).getByText('Cancel up to 24 hours before the appointment.')
    ).toBeTruthy()
    expect(within(policy).getByTestId('btn:confirm').textContent).toBe('I agree')
  })

  it('runs the adults policy before cancellation and shows policy progress', async () => {
    const complete = vi.fn()
    render(
      <BookingLegacyCheckoutPopup
        open
        target={document.body}
        phase="policies"
        policyKinds={['adults', 'cancellation']}
        onClose={vi.fn()}
        onPolicyComplete={complete}
        cancellation={{
          eligible: false,
          cancellableUntil: '2026-07-16T13:00:00.000Z',
          timeZone: 'Europe/Bucharest',
          locale: 'en'
        }}
        copy={{
          cancellationPolicy: 'Cancellation policy',
          cancellationPolicyCopy: 'Cancel by {time} on {date}.',
          noCancellation: 'This appointment cannot be cancelled.',
          now: 'Now',
          appointment: 'Appointment',
          confirmBooking: 'Confirm booking',
          agree: 'I agree',
          close: 'Close',
          adultsTitle: 'Adults only',
          adultsCopy: 'Guests must be 21 or older.',
          adultsConfirm: 'I am 21 or older',
          policiesLabel: 'Policies',
          policyProgress: 'Policy progress',
          checkoutPolicyVersion: 'Checkout policy version {version}'
        }}
      >
        <div />
      </BookingLegacyCheckoutPopup>
    )

    const policy = screen.getByRole('dialog', { name: 'Policies' })
    expect(within(policy).getByTestId('text:adultsTitle')).toBeTruthy()
    expect(within(policy).getAllByTestId('policy:status')).toHaveLength(2)
    fireEvent.click(within(policy).getByTestId('btn:confirm'))
    expect(await within(policy).findByTestId('text:cancellationTitle')).toBeTruthy()
    expect(complete).not.toHaveBeenCalled()
    fireEvent.click(within(policy).getByTestId('btn:confirm'))
    expect(complete).toHaveBeenCalledOnce()
  })

  it('opens customer details directly when no checkout policy applies', () => {
    render(
      <BookingLegacyCheckoutPopup
        open
        target={document.body}
        phase="policies"
        policyKinds={[]}
        onClose={vi.fn()}
        onPolicyComplete={vi.fn()}
        cancellation={null}
        copy={{
          cancellationPolicy: 'Cancellation policy',
          cancellationPolicyCopy: 'Cancel by {time} on {date}.',
          noCancellation: 'This appointment cannot be cancelled.',
          now: 'Now',
          appointment: 'Appointment',
          confirmBooking: 'Confirm booking',
          agree: 'I agree',
          close: 'Close',
          adultsTitle: 'Adults only',
          adultsCopy: 'Guests must be 21 or older.',
          adultsConfirm: 'I am 21 or older',
          policiesLabel: 'Policies',
          policyProgress: 'Policy progress',
          checkoutPolicyVersion: 'Checkout policy version {version}'
        }}
      >
        <div>Customer details</div>
      </BookingLegacyCheckoutPopup>
    )

    const checkout = screen.getByRole('dialog', { name: 'Confirm booking' })
    expect(within(checkout).getByText('Customer details')).toBeTruthy()
    expect(within(checkout).queryByText('Cancellation policy')).toBeNull()
  })

  it('collects each guest consent separately in the legacy notification order', async () => {
    const complete = vi.fn()
    render(
      <BookingLegacyNotificationPolicies
        open
        target={document.body}
        targets={[
          { bookingRequestId: 'brq_one', channel: 'sms' },
          { bookingRequestId: 'brq_one', channel: 'email' },
          { bookingRequestId: 'brq_two', channel: 'sms' }
        ]}
        shopName="Main Shop"
        onClose={vi.fn()}
        onComplete={complete}
        copy={{
          smsTitle: 'Get texts from {shop}?',
          emailTitle: 'Get emails from {shop}?',
          smsCopy: 'Optional texts.',
          emailCopy: 'Optional emails.',
          yes: 'Yes',
          skip: 'Skip',
          close: 'Close',
          notificationPreferences: 'Notification preferences',
          policyProgress: 'Policy progress'
        }}
      />
    )

    const popup = screen.getByRole('dialog', { name: 'Notification preferences' })
    expect(within(popup).getByText('Get texts from Main Shop?')).toBeTruthy()
    fireEvent.click(within(popup).getByTestId('btn:decline'))
    expect(await within(popup).findByText('Get emails from Main Shop?')).toBeTruthy()
    fireEvent.click(within(popup).getByTestId('btn:consent'))
    expect(await within(popup).findByTestId('text:consentsms')).toBeTruthy()
    fireEvent.click(within(popup).getByTestId('btn:consent'))
    expect(complete).toHaveBeenCalledWith([
      { bookingRequestId: 'brq_one', channel: 'sms', granted: false },
      { bookingRequestId: 'brq_one', channel: 'email', granted: true },
      { bookingRequestId: 'brq_two', channel: 'sms', granted: true }
    ])
  })
})
