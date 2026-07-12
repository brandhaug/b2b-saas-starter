// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GiftCardPurchaseFlow } from './gift-card-purchase-flow.tsx'

const copy = {
  unavailable: 'Gift Cards are not available.',
  processing: 'Payment processing.',
  failed: 'Please try again.',
  issued: 'Gift Card ready.',
  amount: 'Choose an amount',
  customAmount: 'Custom amount',
  purchaser: 'From you',
  purchaserName: 'Your name',
  purchaserEmail: 'Your email',
  recipient: 'For the recipient',
  recipientName: 'Recipient name',
  recipientEmail: 'Recipient email',
  message: 'Message',
  continueToPayment: 'Continue to payment',
  scope: {
    brand: 'Across this brand.',
    shop: 'At this shop.',
    provider: 'With this specific professional.'
  }
} as const

describe('Gift Card purchase journey', () => {
  it('captures a permitted amount and purchaser and recipient details', () => {
    const purchase = vi.fn()
    render(
      <GiftCardPurchaseFlow
        product={{
          name: 'A fresh cut',
          currency: 'USD',
          presetAmountsMinor: [2500, 5000],
          allowsCustomAmount: true,
          scope: 'provider'
        }}
        status="idle"
        onPurchase={purchase}
        copy={copy}
        locale="en"
      />
    )
    fireEvent.click(screen.getByRole('button', { name: '$50.00' }))
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Alex' } })
    fireEvent.change(screen.getByLabelText('Your email'), {
      target: { value: 'alex@example.com' }
    })
    fireEvent.change(screen.getByLabelText('Recipient name'), {
      target: { value: 'Sam' }
    })
    fireEvent.change(screen.getByLabelText('Recipient email'), {
      target: { value: 'sam@example.com' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Continue to payment' }))
    expect(purchase).toHaveBeenCalledWith(
      expect.objectContaining({
        amountMinor: 5000,
        purchaser: { name: 'Alex', email: 'alex@example.com' },
        recipient: { name: 'Sam', email: 'sam@example.com', message: '' }
      })
    )
    expect(screen.getByText(/specific professional/i)).toBeTruthy()
  })

  it('shows stable processing, failure, and issued states', () => {
    const { rerender } = render(
      <GiftCardPurchaseFlow
        product={null}
        status="idle"
        onPurchase={() => {}}
        copy={copy}
        locale="en"
      />
    )
    expect(screen.getByRole('status').textContent).toMatch(/not available/i)
    for (const [status, expected] of [
      ['processing', /processing/i],
      ['failed', /try again/i],
      ['issued', /ready/i]
    ] as const) {
      rerender(
        <GiftCardPurchaseFlow
          product={null}
          status={status}
          onPurchase={() => {}}
          copy={copy}
          locale="en"
        />
      )
      expect(screen.getByRole('status').textContent).toMatch(expected)
    }
  })
})
