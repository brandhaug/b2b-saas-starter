import { useState, type FormEvent } from 'react'
import type { BookingLocale } from '../localization/booking-localization.ts'
import { formatBookingCurrency } from '../localization/booking-localization.ts'
import {
  BookingButton,
  BookingField,
  BookingInline,
  BookingSelectableCard,
  BookingStack,
  BookingSurface,
  BookingText
} from '../presentation/booking-primitives.tsx'

export type GiftCardPurchaseProduct = {
  readonly id?: string
  readonly name: string
  readonly currency: string
  readonly presetAmountsMinor: readonly number[]
  readonly allowsCustomAmount: boolean
  readonly customAmountMinMinor?: number | null
  readonly customAmountMaxMinor?: number | null
  readonly scope: 'merchant' | 'brand' | 'shop' | 'provider'
}

type Person = { readonly name: string; readonly email: string }
export type GiftCardPurchaseSubmission = {
  readonly amountMinor: number
  readonly purchaser: Person
  readonly recipient: (Person & { readonly message: string }) | null
}

export type GiftCardPurchaseCopy = {
  readonly unavailable: string
  readonly processing: string
  readonly failed: string
  readonly needsConfiguration: string
  readonly issued: string
  readonly amount: string
  readonly customAmount: string
  readonly purchaser: string
  readonly purchaserName: string
  readonly purchaserEmail: string
  readonly recipient: string
  readonly recipientName: string
  readonly recipientEmail: string
  readonly message: string
  readonly continueToPayment: string
  readonly scope: Record<GiftCardPurchaseProduct['scope'], string>
}

export function GiftCardPurchaseFlow({
  product,
  status,
  onPurchase,
  copy,
  locale
}: {
  readonly product: GiftCardPurchaseProduct | null
  readonly status: 'idle' | 'processing' | 'failed' | 'needsConfiguration' | 'issued'
  readonly onPurchase: (submission: GiftCardPurchaseSubmission) => void
  readonly copy: GiftCardPurchaseCopy
  readonly locale: BookingLocale
}) {
  const [amountMinor, setAmountMinor] = useState(product?.presetAmountsMinor[0] ?? 0)
  const [purchaser, setPurchaser] = useState({ name: '', email: '' })
  const [recipient, setRecipient] = useState({ name: '', email: '', message: '' })
  if (status !== 'idle')
    return (
      <output>
        {status === 'needsConfiguration' ? copy.needsConfiguration : copy[status]}
      </output>
    )
  if (!product) return <output>{copy.unavailable}</output>
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (amountMinor > 0)
      onPurchase({
        amountMinor,
        purchaser,
        recipient:
          recipient.name || recipient.email || recipient.message ? recipient : null
      })
  }
  return (
    <form onSubmit={submit} aria-label={product.name}>
      <BookingStack>
        <BookingText variant="largeTitle">{product.name}</BookingText>
        <BookingText tone="muted">{copy.scope[product.scope]}</BookingText>
        <BookingSurface>
          <BookingStack>
            <BookingText variant="headline">{copy.amount}</BookingText>
            <BookingInline>
              {product.presetAmountsMinor.map((amount) => (
                <BookingSelectableCard
                  key={amount}
                  selected={amountMinor === amount}
                  onClick={() => setAmountMinor(amount)}
                >
                  {formatBookingCurrency(locale, amount, product.currency)}
                </BookingSelectableCard>
              ))}
            </BookingInline>
            {product.allowsCustomAmount ? (
              <BookingField
                label={copy.customAmount}
                type="number"
                min={(product.customAmountMinMinor ?? 1) / 100}
                max={
                  product.customAmountMaxMinor == null
                    ? undefined
                    : product.customAmountMaxMinor / 100
                }
                step="0.01"
                onChange={(event) =>
                  setAmountMinor(Math.round(Number(event.target.value) * 100))
                }
              />
            ) : null}
          </BookingStack>
        </BookingSurface>
        <BookingSurface>
          <BookingStack>
            <BookingText variant="headline">{copy.purchaser}</BookingText>
            <BookingField
              label={copy.purchaserName}
              required
              value={purchaser.name}
              onChange={(event) =>
                setPurchaser({ ...purchaser, name: event.target.value })
              }
            />
            <BookingField
              label={copy.purchaserEmail}
              required
              type="email"
              value={purchaser.email}
              onChange={(event) =>
                setPurchaser({ ...purchaser, email: event.target.value })
              }
            />
          </BookingStack>
        </BookingSurface>
        <BookingSurface>
          <BookingStack>
            <BookingText variant="headline">{copy.recipient}</BookingText>
            <BookingField
              label={copy.recipientName}
              value={recipient.name}
              onChange={(event) =>
                setRecipient({ ...recipient, name: event.target.value })
              }
            />
            <BookingField
              label={copy.recipientEmail}
              type="email"
              value={recipient.email}
              onChange={(event) =>
                setRecipient({ ...recipient, email: event.target.value })
              }
            />
            <BookingField
              label={copy.message}
              value={recipient.message}
              onChange={(event) =>
                setRecipient({ ...recipient, message: event.target.value })
              }
            />
          </BookingStack>
        </BookingSurface>
        <BookingButton type="submit" tone="primary">
          {copy.continueToPayment}
        </BookingButton>
      </BookingStack>
    </form>
  )
}
