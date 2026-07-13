import { useEffect, useRef, useState } from 'react'
import type {
  GiftCardReceipt,
  GiftCardProductOffer
} from '@b2b-saas-starter/capabilities/gift-cards'
import type { BookingLocale } from '../localization/booking-localization.ts'
import {
  BookingLocalizationProvider,
  useBookingLocalization
} from '../localization/booking-localization-provider.tsx'
import {
  BookingStack,
  BookingSurface,
  BookingSelectableCard,
  BookingText,
  BookingViewport
} from '../presentation/booking-primitives.tsx'
import {
  GiftCardPurchaseFlow,
  type GiftCardPurchaseSubmission
} from './gift-card-purchase-flow.tsx'

export function GiftCardRouteFlow({
  pathname,
  kind,
  locale
}: {
  readonly pathname: string
  readonly kind: 'purchase' | 'receipt'
  readonly locale: BookingLocale
}) {
  return (
    <BookingLocalizationProvider sessionLocale={locale} onLocaleChange={() => {}}>
      <BookingViewport>
        <LocalizedGiftCardRoute pathname={pathname} kind={kind} />
      </BookingViewport>
    </BookingLocalizationProvider>
  )
}

function LocalizedGiftCardRoute({
  pathname,
  kind
}: {
  readonly pathname: string
  readonly kind: 'purchase' | 'receipt'
}) {
  const { message, locale } = useBookingLocalization()
  const [products, setProducts] = useState<readonly GiftCardProductOffer[] | null>(null)
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null)
  const [receipt, setReceipt] = useState<GiftCardReceipt | null>(null)
  const [receiptRefresh, setReceiptRefresh] = useState(0)
  const [status, setStatus] = useState<
    'idle' | 'processing' | 'failed' | 'needsConfiguration' | 'issued'
  >('idle')
  const idempotencyKey = useRef(crypto.randomUUID())
  useEffect(() => {
    let active = true
    void fetch(pathname, {
      headers: { accept: 'application/json' },
      credentials: 'same-origin'
    })
      .then(async (response) => {
        if (!active || !response.ok) throw new Error('unavailable')
        const value = await response.json()
        if (kind === 'purchase') {
          const next = value as GiftCardProductOffer[]
          setProducts(next)
          setSelectedProductId((current) => current ?? next[0]?.id ?? null)
        } else {
          const receiptState = value as
            | { state: 'processing' }
            | { state: 'issued'; receipt: GiftCardReceipt }
          if (receiptState.state === 'issued') {
            setReceipt(receiptState.receipt)
            setStatus('issued')
          } else {
            setStatus('processing')
            window.setTimeout(
              () => active && setReceiptRefresh((current) => current + 1),
              1_000
            )
          }
        }
      })
      .catch(() => active && setStatus('failed'))
    return () => {
      active = false
    }
  }, [kind, pathname, receiptRefresh])
  const product = products?.find(({ id }) => id === selectedProductId) ?? null
  const purchase = async (submission: GiftCardPurchaseSubmission) => {
    if (!product) return
    setStatus('processing')
    try {
      const response = await fetch(pathname, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...submission,
          giftCardProductId: product.id,
          currency: product.currency,
          method: 'card',
          paymentMethodReference: 'hosted_checkout',
          idempotencyKey: idempotencyKey.current
        })
      })
      const result = (await response.json()) as {
        state?: string
        nextActionUrl?: string | null
        receiptUrl?: string
      }
      if (result.nextActionUrl) return window.location.assign(result.nextActionUrl)
      if (!response.ok) {
        const error = (result as { error?: string }).error
        return setStatus(
          error === 'gift_card_payment_needs_configuration'
            ? 'needsConfiguration'
            : 'failed'
        )
      }
      if (!result.receiptUrl) return setStatus('failed')
      window.location.assign(result.receiptUrl)
    } catch {
      setStatus('failed')
    }
  }
  if (kind === 'receipt')
    return receipt ? (
      <BookingSurface>
        <BookingStack>
          <BookingText variant="largeTitle">{message('gift_card.issued')}</BookingText>
          <BookingText variant="price">
            {new Intl.NumberFormat(locale, {
              style: 'currency',
              currency: receipt.card.currency
            }).format(receipt.card.balanceMinor / 100)}
          </BookingText>
          <BookingText>
            {receipt.sale.recipient?.name ?? receipt.sale.purchaser.name}
          </BookingText>
          <BookingText>{receipt.card.id}</BookingText>
          <BookingText tone="muted">
            {message(`gift_card.scope_${receipt.card.scope}`)}
          </BookingText>
        </BookingStack>
      </BookingSurface>
    ) : (
      <output>
        {status === 'failed'
          ? message('feedback.error_generic')
          : status === 'processing'
            ? message('gift_card.processing')
            : message('feedback.loading')}
      </output>
    )
  const copy = {
    unavailable: message('gift_card.unavailable'),
    processing: message('gift_card.processing'),
    failed: message('gift_card.failed'),
    needsConfiguration: message('gift_card.needs_configuration'),
    issued: message('gift_card.issued'),
    amount: message('gift_card.amount'),
    customAmount: message('gift_card.custom_amount'),
    purchaser: message('gift_card.purchaser'),
    purchaserName: message('gift_card.purchaser_name'),
    purchaserEmail: message('gift_card.purchaser_email'),
    recipient: message('gift_card.recipient'),
    recipientName: message('gift_card.recipient_name'),
    recipientEmail: message('gift_card.recipient_email'),
    message: message('gift_card.message'),
    continueToPayment: message('gift_card.continue_payment'),
    scope: {
      merchant: message('gift_card.scope_merchant'),
      brand: message('gift_card.scope_brand'),
      shop: message('gift_card.scope_shop'),
      provider: message('gift_card.scope_provider')
    }
  }
  return (
    <BookingStack>
      {products && products.length > 1 ? (
        <BookingSurface>
          <BookingStack>
            {products.map((candidate) => (
              <BookingSelectableCard
                key={candidate.id}
                selected={candidate.id === selectedProductId}
                onClick={() => setSelectedProductId(candidate.id)}
              >
                {candidate.name} — {copy.scope[candidate.scope]}
              </BookingSelectableCard>
            ))}
          </BookingStack>
        </BookingSurface>
      ) : null}
      <GiftCardPurchaseFlow
        key={product?.id ?? 'unavailable'}
        product={product}
        status={products ? status : status === 'failed' ? 'failed' : 'processing'}
        onPurchase={purchase}
        copy={copy}
        locale={locale}
      />
    </BookingStack>
  )
}
