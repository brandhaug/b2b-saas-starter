import { Schema } from 'effect'
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from 'effect/unstable/httpapi'

export const GiftCardPurchasePayload = Schema.Struct({
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

const PurchasePath = Schema.Struct({
  merchantSlug: Schema.String,
  shopSlug: Schema.String,
  providerSlug: Schema.String
})

const ReceiptPath = Schema.Struct({
  merchantSlug: Schema.String,
  routeId: Schema.String
})

const ReceiptQuery = Schema.Struct({ token: Schema.optionalKey(Schema.String) })

export const GiftCardHttpGroup = HttpApiGroup.make('gift-cards')
  .add(
    HttpApiEndpoint.get(
      'listProducts',
      '/:merchantSlug/booking/:shopSlug/:providerSlug/gift-cards',
      { params: PurchasePath, success: Schema.Unknown }
    )
  )
  .add(
    HttpApiEndpoint.post(
      'purchase',
      '/:merchantSlug/booking/:shopSlug/:providerSlug/gift-cards',
      {
        params: PurchasePath,
        payload: GiftCardPurchasePayload,
        success: Schema.Unknown
      }
    )
  )
  .add(
    HttpApiEndpoint.get('receipt', '/:merchantSlug/booking/gift-card-sales/:routeId', {
      params: ReceiptPath,
      query: ReceiptQuery,
      success: Schema.Unknown
    })
  )

export const GiftCardHttpApi = HttpApi.make('gift-card-purchase').add(GiftCardHttpGroup)
