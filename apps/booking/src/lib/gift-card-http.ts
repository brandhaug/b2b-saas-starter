import { Effect, FileSystem, Layer, Path } from 'effect'
import {
  Etag,
  HttpPlatform,
  HttpRouter,
  HttpServerResponse
} from 'effect/unstable/http'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import type {
  GiftCardPurchaseResult,
  GiftCardReceiptState,
  GiftCardProductOffer
} from '@b2b-saas-starter/capabilities/gift-cards'
import { GiftCardHttpApi, GiftCardPurchasePayload } from './gift-card-http-api.ts'

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
  }) => Effect.Effect<Selection, unknown>
  readonly listProducts: (
    selection: Selection
  ) => Effect.Effect<readonly GiftCardProductOffer[], unknown>
  readonly purchase: (
    input: typeof GiftCardPurchasePayload.Type &
      Selection & { now: string; returnUrl: string }
  ) => Effect.Effect<GiftCardPurchaseResult, unknown>
  readonly receiptState: (input: {
    routeId: string
    tokenHash: string
    now: string
  }) => Effect.Effect<GiftCardReceiptState, unknown>
  readonly exchangeReceiptAccess: (input: {
    routeId: string
    presentedTokenHash: string
    cookieTokenHash: string
    now: string
  }) => Effect.Effect<void, unknown>
  readonly hashToken: (token: string) => Effect.Effect<string, unknown>
  readonly now: () => string
}

const cookieName = (routeId: string) => `__Host-gift-card-receipt-${routeId}`
const readCookie = (header: string | undefined, name: string) =>
  header
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1)

const json = (value: unknown, status = 200) =>
  HttpServerResponse.jsonUnsafe(value, {
    status,
    headers: { 'cache-control': 'no-store', 'x-gift-card-api': 'handled' }
  })

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

const handlers = (dependencies: GiftCardHttpDependencies) =>
  HttpApiBuilder.group(GiftCardHttpApi, 'gift-cards', (group) =>
    group
      .handle('listProducts', ({ params }) =>
        dependencies.resolveSelection(params).pipe(
          Effect.flatMap(dependencies.listProducts),
          Effect.map((products) => json(products)),
          Effect.catch((error) =>
            Effect.succeed(failureResponse(error, 'gift_cards_unavailable'))
          )
        )
      )
      .handle('purchase', ({ params, payload, request }) =>
        dependencies.resolveSelection(params).pipe(
          Effect.flatMap((selection) =>
            dependencies.purchase({
              ...payload,
              ...selection,
              now: dependencies.now(),
              returnUrl: `${new URL(request.url, 'https://booking.invalid').origin}/${params.merchantSlug}/booking/gift-card-sales`
            })
          ),
          Effect.map((result) => {
            if (result.state === 'failed') return json(result, 402)
            const receiptUrl = `/${params.merchantSlug}/booking/gift-card-sales/${result.access.routeId}?token=${encodeURIComponent(result.access.token)}`
            return json(
              { ...result, receiptUrl },
              result.state === 'processing' ? 202 : 201
            )
          }),
          Effect.catch((error) =>
            Effect.succeed(failureResponse(error, 'gift_card_purchase_invalid'))
          )
        )
      )
      .handle('receipt', ({ params, query, request }) => {
        const presented = query.token
        const cookie = readCookie(request.headers.cookie, cookieName(params.routeId))
        const token = presented ?? cookie
        if (!token)
          return Effect.succeed(json({ error: 'gift_card_receipt_not_found' }, 404))
        const now = dependencies.now()
        const action = presented
          ? Effect.gen(function* () {
              const cookieCredential = crypto.randomUUID().replaceAll('-', '')
              yield* dependencies.exchangeReceiptAccess({
                routeId: params.routeId,
                presentedTokenHash: yield* dependencies.hashToken(presented),
                cookieTokenHash: yield* dependencies.hashToken(cookieCredential),
                now
              })
              return HttpServerResponse.redirect(
                `/${params.merchantSlug}/booking/gift-card-sales/${params.routeId}`,
                {
                  status: 303,
                  headers: {
                    'set-cookie': `${cookieName(params.routeId)}=${encodeURIComponent(cookieCredential)}; Path=/${params.merchantSlug}/booking/gift-card-sales/${params.routeId}; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`,
                    'cache-control': 'no-store',
                    'x-gift-card-api': 'handled'
                  }
                }
              )
            })
          : Effect.gen(function* () {
              const receipt = yield* dependencies.receiptState({
                routeId: params.routeId,
                tokenHash: yield* dependencies.hashToken(token),
                now
              })
              return request.headers.accept?.includes('application/json')
                ? json(receipt)
                : HttpServerResponse.empty({
                    status: 204,
                    headers: { 'x-gift-card-api': 'handled' }
                  })
            })
        return action.pipe(
          Effect.catch((error) => {
            const tagged = error as { readonly _tag?: string }
            return Effect.succeed(
              tagged._tag === 'CapabilityUnavailable'
                ? failureResponse(error, 'gift_card_receipt_unavailable')
                : json({ error: 'gift_card_receipt_not_found' }, 404)
            )
          })
        )
      })
  )

const PlatformLive = Layer.mergeAll(
  Path.layer,
  Etag.layer,
  FileSystem.layerNoop({}),
  HttpPlatform.layer.pipe(Layer.provide(FileSystem.layerNoop({})))
)

const isGiftCardApiPath = (pathname: string) => {
  const segments = pathname.split('/')
  return segments.includes('gift-cards') || segments.includes('gift-card-sales')
}

export const handleGiftCardRequest = async (
  request: Request,
  dependencies: GiftCardHttpDependencies
): Promise<Response | null> => {
  if (!isGiftCardApiPath(new URL(request.url).pathname)) return null
  const api = HttpApiBuilder.layer(GiftCardHttpApi).pipe(
    Layer.provide(handlers(dependencies)),
    Layer.provide(PlatformLive)
  )
  const built = HttpRouter.toWebHandler(api, { disableLogger: true })
  try {
    return await built.handler(request)
  } finally {
    await built.dispose()
  }
}
