import { Context, Effect, Layer, Schema } from 'effect'
import { CapabilityUnavailable } from '../errors.ts'
import {
  PaymentProvider,
  PaymentProviderFailure,
  type OnlinePaymentMethod
} from '../payments/payment-settlement.ts'

export const GiftCardPerson = Schema.Struct({
  name: Schema.String,
  email: Schema.String,
  message: Schema.optional(Schema.String)
})

export const GiftCardSale = Schema.Struct({
  id: Schema.String,
  status: Schema.Literals([
    'pending_payment',
    'issuing',
    'issued',
    'cancelled',
    'refunded'
  ]),
  shopId: Schema.String,
  giftCardProductId: Schema.String,
  amountMinor: Schema.Number,
  currency: Schema.String,
  purchaser: GiftCardPerson,
  recipient: Schema.NullOr(GiftCardPerson),
  paymentId: Schema.NullOr(Schema.String)
})

export const IssuedGiftCard = Schema.Struct({
  id: Schema.String,
  status: Schema.Literals(['active', 'suspended', 'expired', 'voided']),
  currency: Schema.String,
  scope: Schema.Literals(['merchant', 'brand', 'shop', 'provider']),
  scopeId: Schema.String,
  initialValueMinor: Schema.Number,
  balanceMinor: Schema.Number
})

export class GiftCardSaleConflict extends Schema.TaggedErrorClass<GiftCardSaleConflict>()(
  'GiftCardSaleConflict',
  {
    code: Schema.Literals([
      'product_unavailable',
      'product_scope_mismatch',
      'currency_mismatch',
      'amount_not_permitted',
      'sale_not_found',
      'captured_payment_required',
      'payment_method_unavailable',
      'payment_facts_invalid',
      'purchase_route_not_found',
      'idempotency_mismatch',
      'receipt_key_unavailable',
      'receipt_not_found',
      'spent_value_requires_adjustment'
    ])
  }
) {}

type CreateSaleInput = {
  readonly brandId: string
  readonly shopId: string
  readonly providerId?: string
  readonly giftCardProductId: string
  readonly amountMinor: number
  readonly currency: string
  readonly purchaser: typeof GiftCardPerson.Type
  readonly recipient: typeof GiftCardPerson.Type | null
  readonly idempotencyKey: string
  readonly now: string
}

export type GiftCardReceipt = {
  readonly sale: typeof GiftCardSale.Type
  readonly card: typeof IssuedGiftCard.Type
}
export type GiftCardReceiptState =
  | { readonly state: 'processing' }
  | { readonly state: 'issued'; readonly receipt: GiftCardReceipt }

export type GiftCardPurchaseResult =
  | {
      readonly state: 'processing'
      readonly sale: typeof GiftCardSale.Type
      readonly nextActionUrl: string | null
      readonly access: {
        readonly routeId: string
        readonly token: string
        readonly expiresAt: string
      }
    }
  | {
      readonly state: 'failed'
      readonly sale: typeof GiftCardSale.Type
      readonly failureCode: string
    }
  | {
      readonly state: 'issued'
      readonly receipt: GiftCardReceipt
      readonly access: {
        readonly routeId: string
        readonly token: string
        readonly expiresAt: string
      }
    }

export const hashGiftCardReceiptToken = (token: string) =>
  Effect.promise(async () => {
    const bytes = new TextEncoder().encode(token)
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    return Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, '0')
    ).join('')
  })

export type GiftCardPaymentShape = {
  readonly settle: (input: {
    readonly sale: typeof GiftCardSale.Type
    readonly method: OnlinePaymentMethod
    readonly paymentMethodReference: string
    readonly idempotencyKey: string
    readonly returnUrl: string
    readonly now: string
  }) => Effect.Effect<
    | { readonly outcome: 'succeeded'; readonly paymentId: string }
    | {
        readonly outcome: 'processing'
        readonly paymentId: string
        readonly nextActionUrl: string | null
      }
    | {
        readonly outcome: 'failed'
        readonly paymentId: string
        readonly failureCode: string
      },
    GiftCardSaleConflict | CapabilityUnavailable | PaymentProviderFailure,
    PaymentProvider
  >
}

export class GiftCardPayment extends Context.Service<
  GiftCardPayment,
  GiftCardPaymentShape
>()('@b2b-saas-starter/capabilities/GiftCardPayment') {}

export type GiftCardSalesShape = {
  readonly resolvePurchaseRoute: (input: {
    readonly merchantSlug: string
    readonly shopSlug: string
    readonly providerLocator: string
  }) => Effect.Effect<
    {
      readonly merchantId: string
      readonly brandId: string
      readonly shopId: string
      readonly providerId?: string
    },
    GiftCardSaleConflict | CapabilityUnavailable
  >
  readonly listProducts: (input: {
    readonly merchantId: string
    readonly brandId: string
    readonly shopId: string
    readonly providerId?: string
  }) => Effect.Effect<readonly GiftCardProductOffer[], CapabilityUnavailable>
  readonly createSale: (
    input: CreateSaleInput
  ) => Effect.Effect<
    typeof GiftCardSale.Type,
    GiftCardSaleConflict | CapabilityUnavailable
  >
  readonly protectReceipt: (input: {
    readonly saleId: string
    readonly routeId: string
    readonly tokenHash: string
    readonly signingKeyId: string
    readonly expiresAt: string
    readonly now: string
  }) => Effect.Effect<
    {
      readonly routeId: string
      readonly signingKeyId: string
      readonly expiresAt: string
    },
    GiftCardSaleConflict | CapabilityUnavailable
  >
  readonly issue: (input: {
    readonly saleId: string
    readonly paymentId: string
    readonly idempotencyKey: string
    readonly now: string
    readonly access: {
      readonly routeId: string
      readonly tokenHash: string
      readonly expiresAt: string
    }
  }) => Effect.Effect<GiftCardReceipt, GiftCardSaleConflict | CapabilityUnavailable>
  readonly receipt: (input: {
    readonly routeId: string
    readonly tokenHash: string
    readonly now: string
  }) => Effect.Effect<GiftCardReceipt, GiftCardSaleConflict | CapabilityUnavailable>
  readonly receiptState: (input: {
    readonly routeId: string
    readonly tokenHash: string
    readonly now: string
  }) => Effect.Effect<
    GiftCardReceiptState,
    GiftCardSaleConflict | CapabilityUnavailable
  >
  readonly exchangeReceiptAccess: (input: {
    readonly routeId: string
    readonly presentedTokenHash: string
    readonly cookieTokenHash: string
    readonly now: string
  }) => Effect.Effect<void, GiftCardSaleConflict | CapabilityUnavailable>
  readonly resumeIssuanceForPayment: (input: {
    readonly paymentId: string
    readonly now: string
    readonly spentValueAdjustment?: 'merchant_liability'
  }) => Effect.Effect<
    GiftCardReceipt | null,
    GiftCardSaleConflict | CapabilityUnavailable
  >
}

export class GiftCardSales extends Context.Service<GiftCardSales, GiftCardSalesShape>()(
  '@b2b-saas-starter/capabilities/GiftCardSales'
) {}

export const purchaseAndIssueGiftCard = (
  input: CreateSaleInput & {
    readonly method: OnlinePaymentMethod
    readonly paymentMethodReference: string
    readonly returnUrl: string
    readonly receiptKeyring: {
      readonly currentKeyId: string
      readonly keys: Readonly<Record<string, string>>
    }
  }
) =>
  Effect.gen(function* () {
    const sales = yield* GiftCardSales
    const payments = yield* GiftCardPayment
    const sale = yield* sales.createSale(input)
    const currentSecret = input.receiptKeyring.keys[input.receiptKeyring.currentKeyId]
    if (!currentSecret)
      return yield* new GiftCardSaleConflict({ code: 'receipt_key_unavailable' })
    const candidateToken = yield* hashGiftCardReceiptToken(
      `${currentSecret}:${sale.id}`
    )
    const routeId = `gcr_${suffix(sale.id)}`
    const access = yield* sales.protectReceipt({
      saleId: sale.id,
      routeId,
      tokenHash: yield* hashGiftCardReceiptToken(candidateToken),
      signingKeyId: input.receiptKeyring.currentKeyId,
      expiresAt: new Date(
        new Date(input.now).getTime() + 30 * 24 * 60 * 60 * 1000
      ).toISOString(),
      now: input.now
    })
    const receiptSecret = input.receiptKeyring.keys[access.signingKeyId]
    if (!receiptSecret)
      return yield* new GiftCardSaleConflict({ code: 'receipt_key_unavailable' })
    const token = yield* hashGiftCardReceiptToken(`${receiptSecret}:${sale.id}`)
    const payment = yield* payments.settle({
      sale,
      method: input.method,
      paymentMethodReference: input.paymentMethodReference,
      idempotencyKey: input.idempotencyKey,
      returnUrl: `${input.returnUrl}/${access.routeId}?token=${encodeURIComponent(token)}`,
      now: input.now
    })
    if (payment.outcome === 'processing')
      return {
        state: 'processing' as const,
        sale,
        nextActionUrl: payment.nextActionUrl,
        access: { ...access, token }
      }
    if (payment.outcome === 'failed')
      return { state: 'failed' as const, sale, failureCode: payment.failureCode }
    const receipt = yield* sales.issue({
      saleId: sale.id,
      paymentId: payment.paymentId,
      idempotencyKey: `gift-card-issuance:${sale.id}`,
      now: input.now,
      access: {
        routeId: access.routeId,
        tokenHash: yield* hashGiftCardReceiptToken(token),
        expiresAt: access.expiresAt
      }
    })
    return { state: 'issued' as const, receipt, access: { ...access, token } }
  })

export type GiftCardProductOffer = {
  readonly id: string
  readonly merchantId: string
  readonly name: string
  readonly currency: string
  readonly scope: 'merchant' | 'brand' | 'shop' | 'provider'
  readonly scopeId: string
  readonly presetAmountsMinor: readonly number[]
  readonly allowsCustomAmount: boolean
  readonly customAmountMinMinor?: number | null
  readonly customAmountMaxMinor?: number | null
  readonly active: boolean
}

export type SeedGiftCardSalesStore = ReturnType<typeof emptySeedGiftCardSalesStore>

const suffix = (value: string) => {
  let hash = 2166136261
  for (const character of value)
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619)
  return (hash >>> 0).toString(36)
}

const scopePriority = { provider: 0, shop: 1, brand: 2, merchant: 3 } as const
export const sortGiftCardProducts = <
  A extends { readonly scope: keyof typeof scopePriority }
>(
  products: readonly A[]
) =>
  [...products].sort(
    (left, right) => scopePriority[left.scope] - scopePriority[right.scope]
  )

export const giftCardAmountIsPermitted = (
  product: Pick<
    GiftCardProductOffer,
    | 'presetAmountsMinor'
    | 'allowsCustomAmount'
    | 'customAmountMinMinor'
    | 'customAmountMaxMinor'
  >,
  amountMinor: number
) =>
  Number.isSafeInteger(amountMinor) &&
  amountMinor > 0 &&
  (product.presetAmountsMinor.includes(amountMinor) ||
    (product.allowsCustomAmount &&
      amountMinor >= (product.customAmountMinMinor ?? 1) &&
      amountMinor <= (product.customAmountMaxMinor ?? Number.MAX_SAFE_INTEGER)))

export const emptySeedGiftCardSalesStore = (
  input: {
    readonly products?: readonly GiftCardProductOffer[]
    readonly capturedPayments?: readonly {
      id: string
      amountMinor: number
      currency: string
    }[]
    readonly routes?: readonly {
      merchantSlug: string
      shopSlug: string
      merchantId: string
      brandId: string
      shopId: string
      providerIds?: readonly string[]
    }[]
  } = {}
) => ({
  products: [...(input.products ?? [])],
  routes: [...(input.routes ?? [])],
  capturedPayments: new Map(
    (input.capturedPayments ?? []).map((payment) => [payment.id, payment])
  ),
  sales: new Map<string, typeof GiftCardSale.Type>(),
  saleKeys: new Map<string, string>(),
  cards: new Map<string, typeof IssuedGiftCard.Type>(),
  cardsBySale: new Map<string, string>(),
  receiptAccess: new Map<
    string,
    { saleId: string; tokenHash: string; signingKeyId: string; expiresAt: string }
  >(),
  ledger: [] as Array<{
    id: string
    giftCardId: string
    kind: 'issuance'
    amountMinor: number
    idempotencyKey: string
    occurredAt: string
  }>
})

export const SeedGiftCardPayment = (
  store: SeedGiftCardSalesStore
): Layer.Layer<GiftCardPayment> =>
  Layer.succeed(GiftCardPayment)({
    settle: (input) =>
      Effect.gen(function* () {
        const provider = yield* PaymentProvider
        if (
          provider.configuration.state !== 'configured' ||
          !provider.configuration.methods.includes(input.method)
        )
          return yield* new GiftCardSaleConflict({
            code: 'payment_method_unavailable'
          })
        const paymentId = `pay_${suffix(input.sale.id)}`
        store.sales.set(input.sale.id, { ...input.sale, paymentId })
        if (store.capturedPayments.has(paymentId))
          return { outcome: 'succeeded' as const, paymentId }
        const result = yield* provider.settle({
          payment: {
            id: paymentId,
            bookingPartyId: null,
            pricingQuoteId: null,
            amountMinor: input.sale.amountMinor,
            currency: input.sale.currency,
            status: 'pending',
            authorizedMinor: 0,
            capturedMinor: 0,
            refundedMinor: 0
          },
          attempt: {
            id: `pat_${suffix(input.idempotencyKey)}`,
            paymentId,
            idempotencyKey: input.idempotencyKey,
            provider: provider.configuration.provider,
            method: input.method,
            outcome: 'pending',
            providerReference: null,
            failureCode: null
          },
          paymentMethodReference: input.paymentMethodReference,
          returnUrl: input.returnUrl
        })
        if (result.outcome === 'succeeded') {
          const captures = result.facts.filter((fact) => fact.kind === 'capture')
          if (
            captures.length !== 1 ||
            captures[0]!.amountMinor !== input.sale.amountMinor ||
            captures[0]!.currency !== input.sale.currency
          )
            return yield* new GiftCardSaleConflict({ code: 'payment_facts_invalid' })
          store.capturedPayments.set(paymentId, {
            id: paymentId,
            amountMinor: input.sale.amountMinor,
            currency: input.sale.currency
          })
          store.sales.set(input.sale.id, {
            ...input.sale,
            status: 'issuing',
            paymentId
          })
          return { outcome: 'succeeded' as const, paymentId }
        }
        if (result.outcome === 'processing')
          return {
            outcome: 'processing' as const,
            paymentId,
            nextActionUrl: result.nextActionUrl ?? null
          }
        return {
          outcome: 'failed' as const,
          paymentId,
          failureCode: result.failureCode ?? 'payment_failed'
        }
      })
  })

export const SeedGiftCardSales = (
  store: SeedGiftCardSalesStore
): Layer.Layer<GiftCardSales> => {
  const service: GiftCardSalesShape = {
    resolvePurchaseRoute: (route) =>
      Effect.gen(function* () {
        const selection = store.routes.find(
          (candidate) =>
            candidate.merchantSlug === route.merchantSlug &&
            candidate.shopSlug === route.shopSlug
        )
        if (
          !selection ||
          (route.providerLocator !== 'any' &&
            !selection.providerIds?.includes(route.providerLocator))
        )
          return yield* new GiftCardSaleConflict({
            code: 'purchase_route_not_found'
          })
        return {
          merchantId: selection.merchantId,
          brandId: selection.brandId,
          shopId: selection.shopId,
          ...(route.providerLocator === 'any'
            ? {}
            : { providerId: route.providerLocator })
        }
      }),
    listProducts: ({ merchantId, brandId, shopId, providerId }) =>
      Effect.succeed(
        sortGiftCardProducts(
          store.products.filter(
            (product) =>
              product.active &&
              product.merchantId === merchantId &&
              ((product.scope === 'merchant' && product.scopeId === merchantId) ||
                (product.scope === 'brand' && product.scopeId === brandId) ||
                (product.scope === 'shop' && product.scopeId === shopId) ||
                (product.scope === 'provider' && product.scopeId === providerId))
          )
        )
      ),
    createSale: (input) =>
      Effect.gen(function* () {
        const replayId = store.saleKeys.get(input.idempotencyKey)
        if (replayId) {
          const replay = store.sales.get(replayId)!
          if (
            replay.shopId !== input.shopId ||
            replay.giftCardProductId !== input.giftCardProductId ||
            replay.amountMinor !== input.amountMinor ||
            replay.currency !== input.currency ||
            JSON.stringify(replay.purchaser) !== JSON.stringify(input.purchaser) ||
            JSON.stringify(replay.recipient) !== JSON.stringify(input.recipient)
          )
            return yield* new GiftCardSaleConflict({
              code: 'idempotency_mismatch'
            })
          return replay
        }
        const product = store.products.find(
          (item) => item.id === input.giftCardProductId && item.active
        )
        if (!product)
          return yield* new GiftCardSaleConflict({ code: 'product_unavailable' })
        if (
          (product.scope === 'merchant' && product.scopeId !== product.merchantId) ||
          (product.scope === 'brand' && product.scopeId !== input.brandId) ||
          (product.scope === 'shop' && product.scopeId !== input.shopId) ||
          (product.scope === 'provider' && product.scopeId !== input.providerId)
        )
          return yield* new GiftCardSaleConflict({ code: 'product_scope_mismatch' })
        if (input.currency !== product.currency)
          return yield* new GiftCardSaleConflict({ code: 'currency_mismatch' })
        if (!giftCardAmountIsPermitted(product, input.amountMinor))
          return yield* new GiftCardSaleConflict({ code: 'amount_not_permitted' })
        const sale = {
          id: `gcs_${suffix(input.idempotencyKey)}`,
          status: 'pending_payment' as const,
          shopId: input.shopId,
          giftCardProductId: product.id,
          amountMinor: input.amountMinor,
          currency: input.currency,
          purchaser: input.purchaser,
          recipient: input.recipient,
          paymentId: null
        }
        store.sales.set(sale.id, sale)
        store.saleKeys.set(input.idempotencyKey, sale.id)
        return sale
      }),
    protectReceipt: (input) =>
      Effect.gen(function* () {
        if (!store.sales.has(input.saleId))
          return yield* new GiftCardSaleConflict({ code: 'sale_not_found' })
        const existing = [...store.receiptAccess.entries()].find(
          ([, access]) => access.saleId === input.saleId
        )
        if (existing)
          return {
            routeId: existing[0],
            signingKeyId: existing[1].signingKeyId,
            expiresAt: existing[1].expiresAt
          }
        store.receiptAccess.set(input.routeId, {
          saleId: input.saleId,
          tokenHash: input.tokenHash,
          signingKeyId: input.signingKeyId,
          expiresAt: input.expiresAt
        })
        return {
          routeId: input.routeId,
          signingKeyId: input.signingKeyId,
          expiresAt: input.expiresAt
        }
      }),
    issue: (input) =>
      Effect.gen(function* () {
        const sale = store.sales.get(input.saleId)
        if (!sale) return yield* new GiftCardSaleConflict({ code: 'sale_not_found' })
        if (!store.receiptAccess.has(input.access.routeId))
          store.receiptAccess.set(input.access.routeId, {
            saleId: sale.id,
            tokenHash: input.access.tokenHash,
            signingKeyId: 'direct-issue',
            expiresAt: input.access.expiresAt
          })
        const existingCardId = store.cardsBySale.get(sale.id)
        if (existingCardId)
          return {
            sale: store.sales.get(sale.id)!,
            card: store.cards.get(existingCardId)!
          }
        const payment = store.capturedPayments.get(input.paymentId)
        if (
          !payment ||
          payment.amountMinor !== sale.amountMinor ||
          payment.currency !== sale.currency
        )
          return yield* new GiftCardSaleConflict({ code: 'captured_payment_required' })
        const product = store.products.find(
          (item) => item.id === sale.giftCardProductId
        )!
        const id = `gcd_${suffix(sale.id)}`
        const card = {
          id,
          status: 'active' as const,
          currency: sale.currency,
          scope: product.scope,
          scopeId: product.scopeId,
          initialValueMinor: sale.amountMinor,
          balanceMinor: sale.amountMinor
        }
        const issuedSale = { ...sale, status: 'issued' as const, paymentId: payment.id }
        store.cards.set(id, card)
        store.cardsBySale.set(sale.id, id)
        store.sales.set(sale.id, issuedSale)
        const issuanceKey = `gift-card-issuance:${sale.id}`
        store.ledger.push({
          id: `gcl_${suffix(issuanceKey)}`,
          giftCardId: id,
          kind: 'issuance',
          amountMinor: sale.amountMinor,
          idempotencyKey: issuanceKey,
          occurredAt: input.now
        })
        return { sale: issuedSale, card }
      }),
    receipt: (input) =>
      Effect.gen(function* () {
        const access = store.receiptAccess.get(input.routeId)
        if (
          !access ||
          access.tokenHash !== input.tokenHash ||
          access.expiresAt <= input.now
        )
          return yield* new GiftCardSaleConflict({ code: 'receipt_not_found' })
        const saleId = access.saleId
        const cardId = store.cardsBySale.get(saleId)
        const sale = store.sales.get(saleId)
        const card = cardId ? store.cards.get(cardId) : undefined
        if (!sale || !card)
          return yield* new GiftCardSaleConflict({ code: 'receipt_not_found' })
        return { sale, card }
      }),
    receiptState: (input) =>
      Effect.gen(function* () {
        const access = store.receiptAccess.get(input.routeId)
        if (
          !access ||
          access.tokenHash !== input.tokenHash ||
          access.expiresAt <= input.now
        )
          return yield* new GiftCardSaleConflict({ code: 'receipt_not_found' })
        const sale = store.sales.get(access.saleId)
        if (!sale || sale.status !== 'issued') return { state: 'processing' as const }
        return { state: 'issued' as const, receipt: yield* service.receipt(input) }
      }),
    exchangeReceiptAccess: (input) =>
      Effect.gen(function* () {
        const access = store.receiptAccess.get(input.routeId)
        if (
          !access ||
          access.tokenHash !== input.presentedTokenHash ||
          access.expiresAt <= input.now
        )
          return yield* new GiftCardSaleConflict({ code: 'receipt_not_found' })
        store.receiptAccess.set(input.routeId, {
          ...access,
          tokenHash: input.cookieTokenHash
        })
      }),
    resumeIssuanceForPayment: (input) => {
      const sale = [...store.sales.values()].find(
        (candidate) => candidate.paymentId === input.paymentId
      )
      if (!sale) return Effect.succeed(null)
      const access = [...store.receiptAccess.entries()].find(
        ([, candidate]) => candidate.saleId === sale.id
      )
      if (!access)
        return Effect.fail(new GiftCardSaleConflict({ code: 'receipt_not_found' }))
      return service.issue({
        saleId: sale.id,
        paymentId: input.paymentId,
        idempotencyKey: `gift-card-issuance:${sale.id}`,
        now: input.now,
        access: {
          routeId: access[0],
          tokenHash: access[1].tokenHash,
          expiresAt: access[1].expiresAt
        }
      })
    }
  }
  return Layer.succeed(GiftCardSales)(service)
}
