// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PaymentMethodSelector } from './payment-method-selector.tsx'

afterEach(cleanup)

describe('Payment method selection', () => {
  const copy = {
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
      disabled: 'Online payment is unavailable. You can pay in person.',
      needs_configuration: 'Online payment is not configured. You can pay in person.',
      processing: 'Your payment is processing. Do not submit it again.',
      failed: 'Your payment could not be completed.',
      succeeded: 'Payment complete.'
    }
  } as const
  it('shows only eligible methods and reports the selected method', () => {
    const select = vi.fn()
    render(
      <PaymentMethodSelector
        eligibility={{ state: 'ready', methods: ['card', 'apple_pay'] }}
        selected="pay_in_person"
        status="idle"
        onSelect={select}
        {...copy}
      />
    )
    expect(screen.queryByText('Google Pay')).toBeNull()
    fireEvent.click(screen.getByRole('radio', { name: 'Apple Pay' }))
    expect(select).toHaveBeenCalledWith('apple_pay')
  })

  it('renders deterministic configuration, processing, failure, and success states', () => {
    const { rerender } = render(
      <PaymentMethodSelector
        eligibility={{ state: 'needs_configuration', methods: [] }}
        selected="pay_in_person"
        status="idle"
        onSelect={() => {}}
        {...copy}
      />
    )
    expect(screen.getByRole('status').textContent).toMatch(/not configured/i)
    for (const [status, expected] of [
      ['processing', /payment is processing/i],
      ['failed', /could not be completed/i],
      ['succeeded', /payment complete/i]
    ] as const) {
      rerender(
        <PaymentMethodSelector
          eligibility={{ state: 'ready', methods: ['card'] }}
          selected="card"
          status={status}
          onSelect={() => {}}
          {...copy}
        />
      )
      expect(screen.getByRole('status').textContent).toMatch(expected)
    }
  })

  it('matches the legacy PaymentMethodForm method stack and selection behavior', () => {
    const select = vi.fn()
    render(
      <PaymentMethodSelector
        eligibility={{ state: 'ready', methods: ['card', 'apple_pay'] }}
        selected="pay_in_person"
        status="idle"
        onSelect={select}
        presentation="legacyCheckout"
        {...copy}
      />
    )

    const paymentForm = screen.getByTestId('container:paymentMethodForm')
    expect(paymentForm.tagName).toBe('DIV')
    expect(paymentForm.getAttribute('role')).toBeNull()
    expect(paymentForm.previousElementSibling?.tagName).toBe('P')
    expect(paymentForm.previousElementSibling?.textContent).toBe('Payment method')
    expect(screen.getByTestId('btn:payInStore')).toBeTruthy()
    expect(screen.getByTestId('btn:cardEntry')).toBeTruthy()
    expect(screen.getByTestId('btn:applePay')).toBeTruthy()
    expect(screen.queryByText('Google Pay')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
    expect(paymentForm.querySelector('svg[data-icon="chevron"]')).toBeNull()
    fireEvent.click(screen.getByTestId('btn:applePay'))
    expect(select).toHaveBeenCalledWith('apple_pay')
  })
})
