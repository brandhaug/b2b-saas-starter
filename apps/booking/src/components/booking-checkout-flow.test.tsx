// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BookingCheckoutFlow } from './booking-checkout-flow.tsx'

afterEach(cleanup)

describe('Booking checkout', () => {
  it('uses the legacy checkout form hierarchy inside the booking popup', () => {
    const close = vi.fn()
    const signIn = vi.fn()
    const submit = vi.fn()
    render(
      <BookingCheckoutFlow
        presentation="withinBookingShell"
        popupTarget={document.body}
        shopName="Main Shop"
        shopAlias="Downtown"
        shopImageUrl="/shop-cover.jpg"
        shopAddressLines={['21 Mercer Street', 'New York, NY 10013']}
        review={null}
        preparation={null}
        busy={false}
        validationIssues={[]}
        validationMessages={{}}
        onSubmit={submit}
        onFinalize={vi.fn()}
        onEdit={vi.fn()}
        onClose={close}
        onSignIn={signIn}
        payment={{
          eligibility: { state: 'ready', methods: [] },
          selected: 'pay_in_person',
          status: 'idle',
          allowPayInPerson: true,
          onSelect: vi.fn(),
          legend: 'Payment method',
          labels: {
            pay_in_person: 'Pay in person',
            card: 'Card',
            saved_card: 'Saved card',
            apple_pay: 'Apple Pay',
            google_pay: 'Google Pay',
            cash_app_pay: 'Cash App Pay',
            klarna: 'Buy now, pay later'
          },
          messages: {
            disabled: 'Disabled',
            needs_configuration: 'Needs configuration',
            processing: 'Processing',
            failed: 'Failed',
            succeeded: 'Succeeded'
          }
        }}
      />
    )

    const popup = screen.getByTestId('checkout-form')
    const sectionElements = Array.from(
      popup.querySelectorAll('[data-checkout-section]')
    )
    const sections = sectionElements.map((element) =>
      element.getAttribute('data-checkout-section')
    )
    expect(sections).toEqual(['shop', 'payment', 'customer', 'summary', 'action'])
    expect(sectionElements[0]?.parentElement).toBe(sectionElements[2]?.parentElement)
    expect(sectionElements[3]?.parentElement).toBe(sectionElements[4]?.parentElement)
    expect(sectionElements[0]?.parentElement).not.toBe(
      sectionElements[3]?.parentElement
    )
    const title = screen.getByTestId('container:checkout-title')
    expect(title.tagName).toBe('DIV')
    expect(within(title).getByText('Confirm booking').tagName).toBe('P')
    expect(within(title).getByText('Have an account?').tagName).toBe('P')
    const signInButton = within(title).getByRole('button', { name: 'Sign in' })
    fireEvent.click(signInButton)
    expect(signIn).toHaveBeenCalledOnce()
    const closeButton = within(title).getByTestId('btn:closeCheckout')
    fireEvent.click(closeButton)
    expect(close).toHaveBeenCalledOnce()
    expect(screen.getByText('Main Shop')).toBeTruthy()
    expect(screen.getByText('Downtown')).toBeTruthy()
    const shopImage = within(
      popup.querySelector('[data-checkout-section="shop"]') as HTMLElement
    ).getByRole('img', { name: 'Main Shop' })
    expect(shopImage.getAttribute('src')).toBe('/shop-cover.jpg')
    expect(shopImage.getAttribute('loading')).toBe('eager')
    expect(screen.getByText('21 Mercer Street New York, NY 10013')).toBeTruthy()
    expect(screen.getByText('Payment method')).toBeTruthy()
    expect(screen.getByTestId('btn:payInStore')).toBeTruthy()
    expect(screen.queryByRole('radio')).toBeNull()
    const action = popup.querySelector('[data-checkout-section="action"]')
    expect(action).toBeTruthy()
    const bookButton = within(action as HTMLElement).getByTestId('btn:book')
    expect(within(bookButton).getByText('Book').tagName).toBe('P')
    const termsLink = within(action as HTMLElement).getByRole('link', {
      name: 'Terms of Service'
    })
    const privacyLink = within(action as HTMLElement).getByRole('link', {
      name: 'Privacy Policy'
    })
    expect(termsLink.getAttribute('href')).toBe(
      'https://getsquire.com/terms-of-service'
    )
    expect(privacyLink.getAttribute('href')).toBe(
      'https://getsquire.com/privacy-policy'
    )
    expect(termsLink.getAttribute('target')).toBe('_blank')
    expect(privacyLink.getAttribute('target')).toBe('_blank')
    expect(termsLink.closest('p')?.querySelector('br')).toBeTruthy()
    const customer = popup.querySelector('[data-checkout-section="customer"]')
    expect(customer?.tagName).toBe('DIV')
    expect(within(customer as HTMLElement).getByText('Your information').tagName).toBe(
      'P'
    )
    expect(screen.getByTestId('input:firstName')).toBeTruthy()
    expect(screen.getByTestId('input:lastName')).toBeTruthy()
    expect(screen.getByTestId('input:phone')).toBeTruthy()
    const countryButton = screen.getByTestId('btn:phoneCountry')
    expect(countryButton.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(countryButton)
    const phonePopup = screen.getByTestId('popup:phoneCountry')
    expect(phonePopup.getAttribute('data-popup-layout')).toBe('legacyPhoneCode')
    expect(within(phonePopup).getByText('Choose country').tagName).toBe('P')
    expect(
      within(phonePopup)
        .getByRole('searchbox', { name: 'Search country' })
        .getAttribute('autocomplete')
    ).toBe('new-off')
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search country' }), {
      target: { value: 'Romania' }
    })
    fireEvent.click(
      within(screen.getByTestId('popup:phoneCountry')).getByTestId('btn:close')
    )
    fireEvent.click(countryButton)
    expect(
      (
        screen.getByRole('searchbox', {
          name: 'Search country'
        }) as HTMLInputElement
      ).value
    ).toBe('')
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search country' }), {
      target: { value: 'Romania' }
    })
    fireEvent.click(screen.getByRole('button', { name: /Romania/ }))
    expect(countryButton.getAttribute('aria-label')).toContain('Romania +40')
    expect(screen.getByTestId('input:email')).toBeTruthy()
    expect(screen.getByTestId('input:customerNote')).toBeTruthy()
    expect(screen.getByText('Summary')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Book' }))
    expect(submit).not.toHaveBeenCalled()
    expect(screen.getByText('Last name is required')).toBeTruthy()
    expect(screen.getByText('Enter a valid email address')).toBeTruthy()
    fireEvent.blur(screen.getByTestId('input:firstName'))
    expect(screen.getByText('First name is required')).toBeTruthy()
    fireEvent.blur(screen.getByTestId('input:phone'))
    expect(screen.getByText('Enter a valid phone number')).toBeTruthy()
    fireEvent.change(screen.getByTestId('input:firstName'), {
      target: { value: 'Mara Ionescu' }
    })
    fireEvent.change(screen.getByTestId('input:phone'), {
      target: { value: '753849882' }
    })
    expect((screen.getByTestId('input:phone') as HTMLInputElement).value).toBe(
      '753 849 882'
    )
    expect(screen.queryByText('First name is required')).toBeNull()
    expect(screen.queryByText('Enter a valid phone number')).toBeNull()
    fireEvent.change(screen.getByTestId('input:email'), {
      target: { value: 'mara@example.com' }
    })
    fireEvent.change(screen.getByTestId('input:customerNote'), {
      target: { value: 'Please avoid scented products.' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Book' }))
    expect(submit).toHaveBeenCalledWith({
      name: 'Mara Ionescu',
      email: 'mara@example.com',
      phone: '+40753849882',
      note: 'Please avoid scented products.'
    })
  })

  it('captures minimum details without a consent checkbox', () => {
    const submit = vi.fn()
    const { container } = render(
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
    expect(screen.getByText('Confirm booking').closest('header')?.parentElement).toBe(
      container.firstElementChild
    )
    expect(container.firstElementChild?.getAttribute('data-booking-shell')).toBe(
      'canonical'
    )
    expect(container.querySelector('[aria-busy]')).toBeNull()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Mia' } })
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'mia@example.com' }
    })
    fireEvent.change(screen.getByLabelText('Note (optional)'), {
      target: { value: '  First visit.  ' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Review booking' }))
    expect(submit).toHaveBeenCalledWith({
      name: 'Mia',
      email: 'mia@example.com',
      phone: null,
      note: 'First visit.'
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
          policyEligibility: {
            bookingKind: 'appointment',
            depositRequired: false
          },
          cancellationWindow: {
            eligible: true,
            cancellableUntil: '2026-07-13T08:00:00.000Z'
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
