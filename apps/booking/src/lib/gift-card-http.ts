import { Schema } from 'effect'
import type {
  GiftCardPurchaseResult,
  GiftCardReceiptState,
  GiftCardProductOffer
} from '@b2b-saas-starter/capabilities/gift-cards'

const Purchase = Schema.Struct({
  giftCardProductId: Schema.String,
  amountMinor: Schema.Number,
  currency: Schema.String,
  purchaser: Schema.Struct({ name: Schema.String, email: Schema.String }),
  recipient: Schema.NullOr(
    Schema.Struct({
      name: Schema.String,
      email: Schema.String,
      message: Schema.optional(Schema.String)
    })
  ),
  method: Schema.Literals([
    'card',
    'saved_card',
    'apple_pay',
    'google_pay',
    'cash_app_pay',
    'klarna'
  ]),
  paymentMethodReference: Schema.String,
  idempotencyKey: Schema.String
})

type Selection = {
  readonly merchantId: string
  readonly brandId: string
  readonly shopId: string
  readonly providerId?: string
}
export type GiftCardHttpDependencies = {
  readonly resolveSelection: (input: {
    merchantSlug: string
    shopSlug: string
    providerSlug: string
  }) => Promise<Selection>
  readonly listProducts: (
    selection: Selection
  ) => Promise<readonly GiftCardProductOffer[]>
  readonly purchase: (
    input: typeof Purchase.Type & Selection & { now: string; returnUrl: string }
  ) => Promise<GiftCardPurchaseResult>
  readonly receiptState: (input: {
    routeId: string
    tokenHash: string
    now: string
  }) => Promise<GiftCardReceiptState>
  readonly hashToken: (token: string) => Promise<string>
  readonly now: () => string
}

const cookieName = (routeId: string) => `__Host-gift-card-receipt-${routeId}`
const readCookie = (request: Request, name: string) =>
  request.headers
    .get('cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1)

const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { 'cache-control': 'no-store' } })

const failureResponse = (error: unknown, fallback: string) => {
  const tagged = error as { readonly _tag?: string; readonly code?: string }
  if (
    tagged._tag === 'CapabilityUnavailable' ||
    tagged._tag === 'PaymentProviderFailure'
  )
    return json({ error: 'gift_cards_temporarily_unavailable' }, 503)
  if (tagged.code === 'payment_method_unavailable')
    return json({ error: 'gift_card_payment_needs_configuration' }, 503)
  if (
    tagged.code === 'purchase_route_not_found' ||
    tagged.code === 'product_unavailable'
  )
    return json({ error: 'gift_cards_unavailable' }, 404)
  if (tagged._tag === 'GiftCardSaleConflict') return json({ error: tagged.code }, 409)
  return json({ error: fallback }, 400)
}

export const handleGiftCardRequest = async (
  request: Request,
  dependencies: GiftCardHttpDependencies
): Promise<Response | null> => {
  const url = new URL(request.url)
  const receiptMatch = url.pathname.match(
    /^\/([^/]+)\/booking\/gift-card-sales\/([^/]+)$/
  )
  if (receiptMatch && request.method === 'GET') {
    const routeId = receiptMatch[2]!
    const presented = url.searchParams.get('token')
    const cookie = readCookie(request, cookieName(routeId))
    const token = presented ?? cookie
    if (!token) return json({ error: 'gift_card_receipt_not_found' }, 404)
    try {
      const receiptState = await dependencies.receiptState({
        routeId,
        tokenHash: await dependencies.hashToken(token),
        now: dependencies.now()
      })

      if (!presented)
        return request.headers.get('accept')?.includes('application/json')
          ? json(receiptState)
          : null
      url.searchParams.delete('token')
      return new Response(null, {
        status: 303,
        headers: {
          location: `${url.pathname}${url.search}`,
          'set-cookie': `${cookieName(routeId)}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`,
          'cache-control': 'no-store'
        }
      })
    } catch (error) {
      const tagged = error as { readonly _tag?: string }
      return tagged._tag === 'CapabilityUnavailable'
        ? failureResponse(error, 'gift_card_receipt_unavailable')
        : json({ error: 'gift_card_receipt_not_found' }, 404)
    }
  }

  const purchaseMatch = url.pathname.match(
    /^\/([^/]+)\/booking\/([^/]+)\/([^/]+)\/gift-cards$/
  )
  if (!purchaseMatch) return null
  const [, merchantSlug, shopSlug, providerSlug] = purchaseMatch
  if (
    request.method === 'GET' &&
    request.headers.get('accept')?.includes('application/json')
  ) {
    try {
      const selection = await dependencies.resolveSelection({
        merchantSlug: merchantSlug!,
        shopSlug: shopSlug!,
        providerSlug: providerSlug!
      })
      return json(await dependencies.listProducts(selection))
    } catch (error) {
      return failureResponse(error, 'gift_cards_unavailable')
    }
  }
  if (request.method !== 'POST') return null
  try {
    const body = Schema.decodeUnknownSync(Purchase)(await request.json())
    const selection = await dependencies.resolveSelection({
      merchantSlug: merchantSlug!,
      shopSlug: shopSlug!,
      providerSlug: providerSlug!
    })
    const result = await dependencies.purchase({
      ...body,
      ...selection,
      now: dependencies.now(),
      returnUrl: `${url.origin}/${merchantSlug}/booking/gift-card-sales`
    })
    if (result.state === 'processing')
      return json(
        {
          ...result,
          receiptUrl: `/${merchantSlug}/booking/gift-card-sales/${result.access.routeId}?token=${encodeURIComponent(result.access.token)}`
        },
        202
      )
    if (result.state === 'failed') return json(result, 402)
    return json(
      {
        ...result,
        receiptUrl: `/${merchantSlug}/booking/gift-card-sales/${result.access.routeId}?token=${encodeURIComponent(result.access.token)}`
      },
      201
    )
  } catch (error) {
    return failureResponse(error, 'gift_card_purchase_invalid')
  }
}
