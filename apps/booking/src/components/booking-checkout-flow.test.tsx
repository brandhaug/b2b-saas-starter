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
        preparation={null}
        busy={false}
        validationIssues={[]}
        validationMessages={{}}
        onSubmit={submit}
        onFinalize={vi.fn()}
        onEdit={vi.fn()}
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

  it('keeps invalid Customer Details correctable', () => {
    const view = render(
      <BookingCheckoutFlow
        review={null}
        preparation={null}
        busy={false}
        validationIssues={[
          { field: 'name', code: 'name_required' },
          { field: 'email', code: 'email_invalid' }
        ]}
        validationMessages={{
          name_required: 'Enter your name.',
          email_invalid: 'Enter a valid email address.'
        }}
        onSubmit={vi.fn()}
        onFinalize={vi.fn()}
        onEdit={vi.fn()}
      />
    )
    expect(screen.getByText('Enter your name.')).toBeTruthy()
    expect(screen.getByText('Enter a valid email address.')).toBeTruthy()
    expect(screen.getByLabelText('Name')).toBeTruthy()
    expect(screen.getByLabelText('Email')).toBeTruthy()
    view.rerender(
      <BookingCheckoutFlow
        review={null}
        preparation={null}
        busy={false}
        validationIssues={[
          { field: 'name', code: 'name_required' },
          { field: 'email', code: 'email_invalid' }
        ]}
        validationMessages={{
          name_required: 'Introdu numele.',
          email_invalid: 'Introdu o adresă de e-mail validă.'
        }}
        onSubmit={vi.fn()}
        onFinalize={vi.fn()}
        onEdit={vi.fn()}
      />
    )
    expect(screen.getByText('Introdu numele.')).toBeTruthy()
    expect(screen.getByText('Introdu o adresă de e-mail validă.')).toBeTruthy()
  })

  it('renders only the server review and settled Pay In Person copy', () => {
    const finalize = vi.fn()
    const edit = vi.fn()
    const applyGiftCard = vi.fn()
    render(
      <BookingCheckoutFlow
        busy={false}
        validationIssues={[]}
        validationMessages={{}}
        onSubmit={vi.fn()}
        onFinalize={finalize}
        onEdit={edit}
        giftCard={{
          appliedMinor: 0,
          status: 'idle',
          onApply: applyGiftCard,
          onRemove: vi.fn()
        }}
        preparation={{
          requestReviews: [],
          party: {
            id: 'bpt_one',
            bookingSessionId: 'bsn_one',
            shopId: 'shp_one',
            activeRequestId: 'brq_one',
            lifecycle: 'active',
            currency: 'USD',
            locale: 'en',
            version: 1,
            requests: [
              {
                id: 'brq_one',
                bookingPartyId: 'bpt_one',
                position: 0,
                providerPreference: 'any',
                providerId: 'prv_ava',
                primaryServiceId: 'svc_cut',
                serviceIds: ['svc_cut'],
                holdId: 'hld_one',
                holdExpiresAt: '2026-07-10T09:40:00.000Z',
                customerAccountId: null,
                customerDetails: { name: 'Mia', email: 'mia@example.com', phone: null },
                startsAt: '2026-07-13T09:00:00.000Z',
                endsAt: '2026-07-13T10:00:00.000Z'
              }
            ]
          },
          quote: {
            id: 'pqt_one',
            bookingPartyId: 'bpt_one',
            version: 1,
            currency: 'USD',
            subtotalMinor: 5000,
            adjustmentMinor: 0,
            tipMinor: 0,
            totalMinor: 5000,
            facts: {
              partyVersion: 1,
              pricingPolicyVersion: 0,
              lines: [
                {
                  requestId: 'brq_one',
                  holdId: 'hld_one',
                  serviceIds: ['svc_cut'],
                  amountMinor: 5000
                }
              ],
              policyVersions: ['checkout:3'],
              promotionReservationIds: [],
              giftCardReservationIds: []
            },
            acceptedAt: null,
            expiresAt: '2026-07-10T09:40:00.000Z',
            adjustments: []
          },
          policy: {
            id: 'pol_one',
            scope: 'shop',
            scopeId: 'shp_one',
            kind: 'checkout',
            version: 3,
            disclosure: 'Cancel up to 24 hours before the appointment.',
            effectiveAt: '2026-01-01T00:00:00.000Z',
            retiredAt: null
          },
          marketingPolicy: {
            id: 'pol_marketing',
            scope: 'shop',
            scopeId: 'shp_one',
            kind: 'marketing',
            version: 1,
            disclosure: 'Marketing emails are optional.',
            effectiveAt: '2026-01-01T00:00:00.000Z',
            retiredAt: null
          },
          policyAcceptance: null,
          marketingConsents: []
        }}
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
    expect(screen.getByText('Pay in person')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Book' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Gift card code'), {
      target: { value: 'gcd_one' }
    })
    fireEvent.change(screen.getByLabelText('Amount to apply'), {
      target: { value: '25.00' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Apply gift card' }))
    expect(applyGiftCard).toHaveBeenCalledWith('gcd_one', 2500)
    expect(
      screen.getByText('Cancel up to 24 hours before the appointment.')
    ).toBeTruthy()
    expect(screen.getByText('Mia')).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox', { name: /email offers for mia/i }))
    fireEvent.click(
      screen.getByRole('checkbox', { name: /accept checkout policy version 3/i })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Book' }))
    expect(finalize).toHaveBeenCalledWith({
      acceptQuote: true,
      acceptPolicy: true,
      marketingConsents: [
        {
          bookingRequestId: 'brq_one',
          channel: 'email',
          granted: true
        }
      ]
    })
    expect(
      screen.getByRole('link', { name: 'See the Privacy Policy' }).getAttribute('href')
    ).toBe('/privacy')
    expect(screen.queryByText(/pay now|tax|tip|deposit/i)).toBeNull()
  })
})
