// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PaymentMethodSelector } from './payment-method-selector.tsx'

describe('Payment method selection', () => {
  it('shows only eligible methods and reports the selected method', () => {
    const select = vi.fn()
    render(
      <PaymentMethodSelector
        eligibility={{ state: 'ready', methods: ['card', 'apple_pay'] }}
        selected="pay_in_person"
        status="idle"
        onSelect={select}
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
      />
    )
    expect(screen.getByRole('status').textContent).toMatch(/not configured/i)
    for (const [status, copy] of [
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
        />
      )
      expect(screen.getByRole('status').textContent).toMatch(copy)
    }
  })
})
