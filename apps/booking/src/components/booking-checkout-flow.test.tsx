// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BookingCheckoutFlow } from './booking-checkout-flow.tsx'

afterEach(cleanup)

describe('Booking checkout', () => {
  it('captures minimum details without a consent checkbox', () => {
    const submit = vi.fn()
    render(
      <BookingCheckoutFlow
        review={null}
        busy={false}
        invalid={false}
        onSubmit={submit}
      />
    )
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Mia' } })
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'mia@example.com' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Review booking' }))
    expect(submit).toHaveBeenCalledWith({
      name: 'Mia',
      email: 'mia@example.com',
      phone: null
    })
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('renders only the server review and settled Pay In Person copy', () => {
    render(
      <BookingCheckoutFlow
        busy={false}
        invalid={false}
        onSubmit={vi.fn()}
        review={{
          customerDetails: { name: 'Mia', email: 'mia@example.com', phone: null },
          checkoutPath: 'pay_in_person',
          holdExpiresAt: '2026-07-10T09:40:00.000Z',
          quote: {
            startsAt: '2026-07-13T09:00:00.000Z',
            endsAt: '2026-07-13T10:00:00.000Z',
            providerPreference: { kind: 'any' },
            assignedProvider: { id: 'prv_ava', displayName: 'Ava' },
            services: [
              {
                id: 'svc_cut',
                role: 'primary',
                name: 'Cut',
                durationMinutes: 60,
                priceMinor: 5000,
                currency: 'USD'
              }
            ],
            durationMinutes: 60,
            currency: 'USD',
            totalMinor: 5000
          }
        }}
      />
    )
    expect(screen.getByRole('heading', { name: 'Confirm booking' })).toBeTruthy()
    expect(screen.getByText('Pay In Person')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Book' })).toBeTruthy()
    expect(
      screen.getByRole('link', { name: 'Terms of Service' }).getAttribute('href')
    ).toBe('/terms')
    expect(
      screen.getByRole('link', { name: 'Privacy Policy' }).getAttribute('href')
    ).toBe('/privacy')
    expect(screen.queryByText(/pay now|tax|tip|deposit/i)).toBeNull()
  })
})
