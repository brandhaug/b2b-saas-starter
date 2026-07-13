import startServer from '@tanstack/react-start/server-entry'
import { env as workerEnv } from 'cloudflare:workers'
import { Effect, Layer, Schema } from 'effect'
import {
  BookingSelection,
  BookingScheduling,
  BookingCheckout,
  BookingSessions,
  BookingConfirmation,
  BookingParties,
  enterBookingSession
} from '@b2b-saas-starter/capabilities/booking'
import {
  associateVerifiedBooking,
  CustomerIdentity
} from '@b2b-saas-starter/capabilities/customer-identity'
import { selectCapabilitiesLayer } from '@b2b-saas-starter/capabilities/runtime'
import {
  GiftCardRedemptions,
  GiftCardSales,
  hashGiftCardReceiptToken,
  purchaseAndIssueGiftCard
} from '@b2b-saas-starter/capabilities/gift-cards'
import { ShopTopology } from '@b2b-saas-starter/capabilities/merchant-catalog'
import { WalkIns } from '@b2b-saas-starter/capabilities/walk-ins'
import {
  eligiblePaymentMethods,
  PaymentProvider,
  PaymentProviderFailure,
  PaymentProviderResult,
  PaymentSettlement,
  PaymentSettlementConflict,
  settleAcceptedPricingQuote
} from '@b2b-saas-starter/capabilities/payments'
import { readTraceHeader, reportOperationalError } from '@b2b-saas-starter/logger'
import { handleBookingSessionRequest } from './lib/booking-session-http.ts'
import { makeStripePaymentProvider } from './lib/stripe-payment-provider.ts'
import { handleGiftCardRequest } from './lib/gift-card-http.ts'
import {
  customerAuthProviderOutcome,
  customerAuthProviderState,
  makeCustomerAuthEdge
} from './lib/customer-auth-edge.ts'
import { recoverVerifiedContinuation } from './lib/customer-continuation-http.ts'
import { WaitingList } from '@b2b-saas-starter/capabilities/waiting-list'
import { handleWaitingListRequest } from './lib/waiting-list-http.ts'
import { handleWalkInRequest } from './lib/walk-in-http.ts'

type RateLimitBinding = {
  readonly limit: (input: { readonly key: string }) => Promise<{
    readonly success: boolean
  }>
}

export type BookingWorkerEnv = {
  readonly DB: D1Database
  readonly PUBLIC_SITE_ORIGIN: string
  readonly RATE_LIMITER_BOOKING_READ?: RateLimitBinding
  readonly RATE_LIMITER_BOOKING_WRITE?: RateLimitBinding
  readonly BOOKING_EVENTS_QUEUE?: {
    readonly send: (message: { readonly outboxId: string }) => Promise<unknown>
  }
  readonly CONFIRMATION_SIGNING_KEYS: string
  readonly CONFIRMATION_CURRENT_KEY_ID: string
  readonly PAYMENT_PROVIDER_NAME?: string
  readonly PAYMENT_PROVIDER_METHODS?: string
  readonly STRIPE_SECRET_KEY?: string
  readonly STRIPE_WEBHOOK_SECRET?: string
  readonly CUSTOMER_AUTH_SECRET?: string
  readonly CUSTOMER_GOOGLE_ENABLED?: string
  readonly CUSTOMER_GOOGLE_CLIENT_ID?: string
  readonly CUSTOMER_GOOGLE_CLIENT_SECRET?: string
  readonly CUSTOMER_APPLE_ENABLED?: string
  readonly CUSTOMER_APPLE_CLIENT_ID?: string
  readonly CUSTOMER_APPLE_CLIENT_SECRET?: string
  readonly PAYMENT_PROVIDER?: {
    readonly fetch: (request: Request) => Promise<Response>
  }
}

const ONLINE_METHODS = [
  'card',
  'saved_card',
  'apple_pay',
  'google_pay',
  'cash_app_pay',
  'klarna'
] as const

const PaymentProviderCallback = Schema.Struct({
  paymentId: Schema.String.check(Schema.isMinLength(1)),
  providerEventId: Schema.String.check(Schema.isMinLength(1)),
  facts: PaymentProviderResult.fields.facts
})

const configuredPaymentMethods = (env: BookingWorkerEnv) => {
  const requested = new Set(
    (env.PAYMENT_PROVIDER_METHODS ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  )
  if (requested.size === 0 && env.STRIPE_SECRET_KEY) requested.add('card')
  return ONLINE_METHODS.filter((method) => requested.has(method))
}

export const reconcilePaymentCallback = async (
  request: Request,
  provider: string,
  binding: NonNullable<BookingWorkerEnv['PAYMENT_PROVIDER']>,
  reconcile: (event: typeof PaymentProviderCallback.Type) => Promise<void>
): Promise<Response> => {
  try {
    const verified = await binding.fetch(
      new Request('https://payment-provider.invalid/verify-callback', {
        method: 'POST',
        headers: request.headers,
        body: await request.arrayBuffer()
      })
    )
    if (!verified.ok) return new Response('Invalid callback', { status: 400 })
    const event = Schema.decodeUnknownSync(PaymentProviderCallback)(
      await verified.json()
    )
    await reconcile(event)
    return new Response(null, { status: 204 })
  } catch {
    return new Response('Payment reconciliation unavailable', {
      status: 503,
      headers: { 'retry-after': '60', 'x-payment-provider': provider }
    })
  }
}

export const publishBookingWakeUp = async <A extends { readonly outboxId: string }>(
  queue: BookingWorkerEnv['BOOKING_EVENTS_QUEUE'],
  result: A
): Promise<A> => {
  try {
    await queue?.send({ outboxId: result.outboxId })
  } catch {
    // The durable outbox is authoritative; publication is only a wake-up.
  }
  return result
}

export const reconcilePaymentAndResumeGiftCard = async <
  A extends {
    readonly payment: { readonly id: string; readonly status: string }
  }
>(
  reconcile: () => Promise<A>,
  resume: (paymentId: string) => Promise<unknown>
): Promise<A> => {
  const view = await reconcile()
  if (['captured', 'refunded', 'cancelled'].includes(view.payment.status))
    await resume(view.payment.id)
  return view
}

type FallbackRateState = { count: number; resetAt: number }
const fallbackRates = new Map<string, FallbackRateState>()

const takeRate = async (
  binding: RateLimitBinding | undefined,
  key: string,
  limit: number
): Promise<boolean> => {
  if (binding) {
    try {
      return (await binding.limit({ key })).success
    } catch {
      // Keep a best-effort local brake when the distributed binding degrades.
    }
  }
  const now = Date.now()
  const current = fallbackRates.get(key)
  if (!current || current.resetAt <= now) {
    fallbackRates.set(key, { count: 1, resetAt: now + 60_000 })
    return true
  }
  if (current.count >= limit) return false
  current.count += 1
  return true
}

export default {
  async fetch(request: Request, passedEnv?: BookingWorkerEnv): Promise<Response> {
    const env = passedEnv ?? (workerEnv as Partial<BookingWorkerEnv>)
    const missingBindings = [
      ...(!env.DB ? ['DB'] : []),
      ...(!env.PUBLIC_SITE_ORIGIN ? ['PUBLIC_SITE_ORIGIN'] : []),
      ...(!env.CONFIRMATION_SIGNING_KEYS ? ['CONFIRMATION_SIGNING_KEYS'] : []),
      ...(!env.CONFIRMATION_CURRENT_KEY_ID ? ['CONFIRMATION_CURRENT_KEY_ID'] : [])
    ]
    if (missingBindings.length > 0) {
      await reportOperationalError({
        service: 'booking',
        event: 'booking.worker_unavailable',
        traceId: readTraceHeader(request) ?? 'unavailable',
        pathname: new URL(request.url).pathname,
        failure: 'missing_worker_bindings',
        details: { missingBindings }
      })
      return new Response('Booking temporarily unavailable', {
        status: 503,
        headers: { 'retry-after': '60' }
      })
    }
    const readyEnv = env as BookingWorkerEnv
    const requestUrl = new URL(request.url)
    const customerAuthConfig = {
      db: readyEnv.DB,
      secret: readyEnv.CUSTOMER_AUTH_SECRET ?? '',
      baseURL: `${readyEnv.PUBLIC_SITE_ORIGIN.replace(/\/$/, '')}/api/customer-auth`,
      trustedOrigin: readyEnv.PUBLIC_SITE_ORIGIN,
      production: requestUrl.protocol === 'https:',
      googleEnabled: readyEnv.CUSTOMER_GOOGLE_ENABLED === 'true',
      appleEnabled: readyEnv.CUSTOMER_APPLE_ENABLED === 'true',
      ...(readyEnv.CUSTOMER_GOOGLE_CLIENT_ID
        ? { googleClientId: readyEnv.CUSTOMER_GOOGLE_CLIENT_ID }
        : {}),
      ...(readyEnv.CUSTOMER_GOOGLE_CLIENT_SECRET
        ? { googleClientSecret: readyEnv.CUSTOMER_GOOGLE_CLIENT_SECRET }
        : {}),
      ...(readyEnv.CUSTOMER_APPLE_CLIENT_ID
        ? { appleClientId: readyEnv.CUSTOMER_APPLE_CLIENT_ID }
        : {}),
      ...(readyEnv.CUSTOMER_APPLE_CLIENT_SECRET
        ? { appleClientSecret: readyEnv.CUSTOMER_APPLE_CLIENT_SECRET }
        : {})
    }
    const customerAuth = readyEnv.CUSTOMER_AUTH_SECRET
      ? makeCustomerAuthEdge(customerAuthConfig)
      : null
    if (requestUrl.pathname === '/customer-identity/providers') {
      const authenticatedProvider =
        (await customerAuth?.principal(request.headers))?.provider ?? null
      return Response.json(
        {
          anonymousBooking: 'available',
          providers: customerAuthProviderState(customerAuthConfig),
          outcome: customerAuthProviderOutcome(requestUrl, authenticatedProvider)
        },
        { headers: { 'cache-control': 'private, no-store' } }
      )
    }
    if (requestUrl.pathname.startsWith('/api/customer-auth/')) {
      if (!customerAuth) {
        return new Response('Customer sign-in needs configuration', {
          status: 503,
          headers: { 'retry-after': '60' }
        })
      }
      return (
        (await customerAuth.handle(request)) ??
        new Response('Not found', { status: 404 })
      )
    }
    let signingKeys: Readonly<Record<string, string>> = {}
    try {
      signingKeys = JSON.parse(readyEnv.CONFIRMATION_SIGNING_KEYS) as Record<
        string,
        string
      >
    } catch {
      /* handled by capability */
    }
    const capabilitiesLayer = selectCapabilitiesLayer(readyEnv, {
      confirmationKeyring: {
        currentKeyId: readyEnv.CONFIRMATION_CURRENT_KEY_ID,
        keys: signingKeys
      }
    })
    const continuationMatch = requestUrl.pathname.match(
      /^\/([^/]+)\/booking\/customer\/continuation\/([^/]+)$/
    )
    if (continuationMatch && customerAuth) {
      const merchantSlug = decodeURIComponent(continuationMatch[1]!)
      const routeId = decodeURIComponent(continuationMatch[2]!)
      const merchant = await readyEnv.DB.prepare(
        'SELECT id FROM merchants WHERE slug = ? LIMIT 1'
      )
        .bind(merchantSlug)
        .first<{ id: string }>()
      if (!merchant) return new Response('Not found', { status: 404 })
      return recoverVerifiedContinuation(
        request,
        { merchantId: merchant.id, merchantSlug, routeId },
        {
          principal: customerAuth.principal,
          establishSession: (input) =>
            Effect.provide(
              Effect.flatMap(CustomerIdentity, (identity) =>
                identity.establishSession(input)
              ),
              capabilitiesLayer
            ),
          recover: (input) =>
            Effect.provide(
              Effect.flatMap(CustomerIdentity, (identity) =>
                identity.recoverContinuation(input)
              ),
              capabilitiesLayer
            ),
          reissue: (input) =>
            Effect.provide(
              Effect.flatMap(BookingConfirmation, (confirmation) =>
                confirmation.recoverAccess({
                  bookingPartyId: input.bookingPartyId,
                  confirmationRouteId: input.confirmationRouteId,
                  now: input.now
                })
              ),
              capabilitiesLayer
            )
        }
      )
    }
    const paymentProvider =
      readyEnv.PAYMENT_PROVIDER ??
      (readyEnv.STRIPE_SECRET_KEY
        ? makeStripePaymentProvider({
            secretKey: readyEnv.STRIPE_SECRET_KEY,
            ...(readyEnv.STRIPE_WEBHOOK_SECRET
              ? { webhookSecret: readyEnv.STRIPE_WEBHOOK_SECRET }
              : {})
          })
        : undefined)
    const paymentProviderName =
      readyEnv.PAYMENT_PROVIDER_NAME ??
      (readyEnv.STRIPE_SECRET_KEY ? 'stripe' : 'unconfigured')
    const methods = configuredPaymentMethods(readyEnv)
    const paymentProviderLayer = Layer.succeed(PaymentProvider)({
      configuration: {
        provider: paymentProviderName,
        state:
          methods.length === 0
            ? 'disabled'
            : paymentProvider
              ? 'configured'
              : 'needs_configuration',
        methods
      },
      settle: (input) =>
        Effect.tryPromise({
          try: async () => {
            if (!paymentProvider) throw new Error('provider_not_configured')
            const response = await paymentProvider.fetch(
              new Request('https://payment-provider.invalid/settle', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                  paymentId: input.payment.id,
                  attemptId: input.attempt.id,
                  amountMinor: input.payment.amountMinor,
                  currency: input.payment.currency,
                  method: input.attempt.method,
                  paymentMethodReference: input.paymentMethodReference,
                  idempotencyKey: input.attempt.idempotencyKey,
                  returnUrl: input.returnUrl
                })
              })
            )
            if (!response.ok) throw new Error(`provider_${response.status}`)
            return Schema.decodeUnknownSync(PaymentProviderResult)(
              await response.json()
            )
          },
          catch: (cause) =>
            new PaymentProviderFailure({
              code: cause instanceof Error ? cause.message : 'provider_error'
            })
        })
    })
    const runtimeLayer = Layer.merge(capabilitiesLayer, paymentProviderLayer)
    const waitingListResponse = await handleWaitingListRequest(request, {
      apply: (input) =>
        Effect.runPromise(
          Effect.flatMap(WaitingList, (waitingList) => waitingList.apply(input)).pipe(
            Effect.provide(capabilitiesLayer)
          )
        ),
      withdraw: (applicationId, capability, now) =>
        Effect.runPromise(
          Effect.flatMap(WaitingList, (waitingList) =>
            waitingList.withdraw(applicationId, capability, now)
          ).pipe(Effect.provide(capabilitiesLayer))
        ),
      inspectApplication: (applicationId, capability, now) =>
        Effect.runPromise(
          Effect.flatMap(WaitingList, (waitingList) =>
            waitingList.inspectApplication(applicationId, capability, now)
          ).pipe(Effect.provide(capabilitiesLayer))
        ),
      inspect: (offerId, capability, now) =>
        Effect.runPromise(
          Effect.flatMap(WaitingList, (waitingList) =>
            waitingList.inspectOffer(offerId, capability, now)
          ).pipe(Effect.provide(capabilitiesLayer))
        ),
      exchangeOfferAccess: (input) =>
        Effect.runPromise(
          Effect.flatMap(WaitingList, (waitingList) =>
            waitingList.exchangeOfferAccess(input)
          ).pipe(Effect.provide(capabilitiesLayer))
        ),
      decline: (offerId, capability, now) =>
        Effect.runPromise(
          Effect.flatMap(WaitingList, (waitingList) =>
            waitingList.declineOffer(offerId, capability, now)
          ).pipe(Effect.provide(capabilitiesLayer))
        ),
      accept: (offerId, capability, now) =>
        Effect.runPromise(
          Effect.flatMap(WaitingList, (waitingList) =>
            waitingList.acceptOffer(offerId, capability, now)
          ).pipe(Effect.provide(capabilitiesLayer))
        ),
      now: () => new Date().toISOString(),
      newApplicationId: () => `wla_${crypto.randomUUID().replaceAll('-', '')}`,
      newApplicationCapability: () => crypto.randomUUID().replaceAll('-', ''),
      newOfferCookieCapability: () => crypto.randomUUID().replaceAll('-', ''),
      authorizeReplacement: async (input) => {
        const result = await Effect.runPromise(
          Effect.flatMap(BookingConfirmation, (confirmation) =>
            confirmation.read({
              routeId: input.routeId,
              merchantSlug: input.merchantSlug,
              credential: input.cookieCredential,
              credentialKind: 'cookie',
              now: input.now
            })
          ).pipe(Effect.provide(capabilitiesLayer))
        )
        if (
          result.kind !== 'found' ||
          !result.confirmation.appointments.some(
            (appointment) => appointment.id === input.appointmentId
          )
        )
          throw new Error('replacement_not_authorized')
      }
    })
    if (waitingListResponse) return waitingListResponse
    const giftCardResponse = await handleGiftCardRequest(request, {
      resolveSelection: ({ merchantSlug, shopSlug, providerSlug }) =>
        Effect.flatMap(GiftCardSales, (sales) =>
          sales.resolvePurchaseRoute({
            merchantSlug,
            shopSlug,
            providerLocator: providerSlug
          })
        ).pipe(Effect.provide(capabilitiesLayer)),
      listProducts: (selection) =>
        Effect.flatMap(GiftCardSales, (sales) => sales.listProducts(selection)).pipe(
          Effect.provide(capabilitiesLayer)
        ),
      purchase: (input) =>
        signingKeys[readyEnv.CONFIRMATION_CURRENT_KEY_ID]
          ? purchaseAndIssueGiftCard({
              ...input,
              receiptKeyring: {
                currentKeyId: readyEnv.CONFIRMATION_CURRENT_KEY_ID,
                keys: signingKeys
              }
            }).pipe(Effect.provide(runtimeLayer))
          : Effect.fail({ _tag: 'CapabilityUnavailable' }),
      receiptState: (input) =>
        Effect.flatMap(GiftCardSales, (sales) => sales.receiptState(input)).pipe(
          Effect.provide(capabilitiesLayer)
        ),
      exchangeReceiptAccess: (input) =>
        Effect.flatMap(GiftCardSales, (sales) =>
          sales.exchangeReceiptAccess(input)
        ).pipe(Effect.provide(capabilitiesLayer)),
      hashToken: hashGiftCardReceiptToken,
      now: () => new Date().toISOString()
    })
    if (giftCardResponse) return giftCardResponse
    const walkInResponse = await handleWalkInRequest(request, {
      resolveShop: (input) =>
        Effect.flatMap(ShopTopology, (topology) =>
          topology.findByBookingPath(input)
        ).pipe(Effect.provide(capabilitiesLayer)),
      overview: (shopId) =>
        Effect.flatMap(WalkIns, (walkIns) => walkIns.overview(shopId)).pipe(
          Effect.provide(capabilitiesLayer)
        ),
      enroll: (input) =>
        Effect.flatMap(WalkIns, (walkIns) => walkIns.enroll(input)).pipe(
          Effect.provide(capabilitiesLayer)
        ),
      inspect: (input) =>
        Effect.flatMap(WalkIns, (walkIns) => walkIns.inspect(input)).pipe(
          Effect.provide(capabilitiesLayer)
        )
    })
    if (walkInResponse) return walkInResponse
    const callbackMatch = new URL(request.url).pathname.match(
      /^\/[^/]+\/booking\/payment-callback\/([^/]+)$/
    )
    if (callbackMatch && request.method === 'POST') {
      if (!paymentProvider || callbackMatch[1] !== paymentProviderName)
        return new Response('Not found', { status: 404 })
      return reconcilePaymentCallback(
        request,
        callbackMatch[1]!,
        paymentProvider,
        async (event) => {
          const now = new Date().toISOString()
          await reconcilePaymentAndResumeGiftCard(
            () =>
              Effect.runPromise(
                Effect.flatMap(PaymentSettlement, (payments) =>
                  payments.reconcile({
                    paymentId: event.paymentId,
                    provider: callbackMatch[1]!,
                    providerEventId: event.providerEventId,
                    facts: event.facts ?? [],
                    now
                  })
                ).pipe(Effect.provide(capabilitiesLayer))
              ),
            (paymentId) =>
              Effect.runPromise(
                Effect.flatMap(GiftCardSales, (sales) =>
                  sales.resumeIssuanceForPayment({ paymentId, now })
                ).pipe(Effect.provide(capabilitiesLayer))
              )
          )
        }
      )
    }
    return Effect.runPromise(
      handleBookingSessionRequest(request, {
        publicSiteOrigin: readyEnv.PUBLIC_SITE_ORIGIN,
        enter: (input) => Effect.provide(enterBookingSession(input), capabilitiesLayer),
        authorize: (input) =>
          Effect.provide(
            Effect.flatMap(BookingSessions, (sessions) => sessions.authorize(input)),
            capabilitiesLayer
          ),
        authorizeRoute: (input) =>
          Effect.provide(
            Effect.flatMap(BookingSessions, (sessions) =>
              sessions.authorizeRoute(input)
            ),
            capabilitiesLayer
          ),
        captureContext: (session, context) =>
          Effect.provide(
            Effect.flatMap(BookingSessions, (sessions) =>
              sessions.captureContext(session, context)
            ),
            capabilitiesLayer
          ),
        parties: {
          load: (session) =>
            Effect.provide(
              Effect.flatMap(BookingParties, (parties) =>
                parties.findForSession(session.id)
              ),
              capabilitiesLayer
            ),
          add: (partyId, version, now) =>
            Effect.provide(
              Effect.flatMap(BookingParties, (parties) =>
                parties.addRequest(partyId, version, now)
              ),
              capabilitiesLayer
            ),
          remove: (partyId, requestId, version, now) =>
            Effect.provide(
              Effect.flatMap(BookingParties, (parties) =>
                parties.removeRequest(partyId, requestId, version, now)
              ),
              capabilitiesLayer
            ),
          reorder: (partyId, requestIds, version, now) =>
            Effect.provide(
              Effect.flatMap(BookingParties, (parties) =>
                parties.reorderRequests(partyId, requestIds, version, now)
              ),
              capabilitiesLayer
            ),
          update: (partyId, requestId, material, version, now) =>
            Effect.provide(
              Effect.flatMap(BookingParties, (parties) =>
                parties.updateRequest(partyId, requestId, material, version, now)
              ),
              capabilitiesLayer
            ),
          activate: (partyId, requestId, version, now) =>
            Effect.provide(
              Effect.flatMap(BookingParties, (parties) =>
                parties.activateRequest(partyId, requestId, version, now)
              ),
              capabilitiesLayer
            )
        },
        selection: {
          load: (session, now) =>
            Effect.provide(
              Effect.flatMap(BookingSelection, (selection) =>
                selection.load(session, now)
              ),
              capabilitiesLayer
            ),
          chooseProvider: (session, preference, expectedVersion, providerProof, now) =>
            Effect.provide(
              Effect.flatMap(BookingSelection, (selection) =>
                selection.chooseProvider(
                  session,
                  preference,
                  expectedVersion,
                  providerProof,
                  now
                )
              ),
              capabilitiesLayer
            ),
          verifyProviderAccess: (session, providerId, passcode, now) =>
            Effect.provide(
              Effect.flatMap(BookingSelection, (selection) =>
                selection.verifyProviderAccess(session, providerId, passcode, now)
              ),
              capabilitiesLayer
            ),
          chooseShop: (session, shopId, expectedVersion) =>
            Effect.provide(
              Effect.flatMap(BookingSelection, (selection) =>
                selection.chooseShop(session, shopId, expectedVersion)
              ),
              capabilitiesLayer
            ),
          chooseServices: (session, input, expectedVersion) =>
            Effect.provide(
              Effect.flatMap(BookingSelection, (selection) =>
                selection.chooseServices(session, input, expectedVersion)
              ),
              capabilitiesLayer
            )
        },
        scheduling: {
          availability: (session, input) =>
            Effect.provide(
              Effect.flatMap(BookingScheduling, (scheduling) =>
                scheduling.availability(session, input)
              ),
              capabilitiesLayer
            ),
          hold: (session, input) =>
            Effect.provide(
              Effect.flatMap(BookingScheduling, (scheduling) =>
                scheduling.hold(session, input)
              ),
              capabilitiesLayer
            ),
          holdParty: (session, input) =>
            Effect.provide(
              Effect.flatMap(BookingScheduling, (scheduling) =>
                scheduling.holdParty(session, input)
              ),
              capabilitiesLayer
            ),
          release: (session) =>
            Effect.provide(
              Effect.flatMap(BookingScheduling, (scheduling) =>
                scheduling.release(session)
              ),
              capabilitiesLayer
            )
        },
        checkout: {
          saveCustomerDetails: (session, details, input) =>
            Effect.provide(
              Effect.flatMap(BookingCheckout, (checkout) =>
                checkout.saveCustomerDetails(session, details, input)
              ),
              capabilitiesLayer
            ),
          review: (session, input) =>
            Effect.provide(
              Effect.flatMap(BookingCheckout, (checkout) =>
                checkout.review(session, input)
              ),
              capabilitiesLayer
            ),
          prepare: (session, input) =>
            Effect.provide(
              Effect.flatMap(BookingCheckout, (checkout) =>
                checkout.prepare(session, input)
              ),
              capabilitiesLayer
            ),
          acceptQuote: (session, input) =>
            Effect.provide(
              Effect.flatMap(BookingCheckout, (checkout) =>
                checkout.acceptQuote(session, input)
              ),
              capabilitiesLayer
            ),
          acceptPolicy: (session, input) =>
            Effect.provide(
              Effect.flatMap(BookingCheckout, (checkout) =>
                checkout.acceptPolicy(session, input)
              ),
              capabilitiesLayer
            ),
          recordMarketingConsent: (session, input) =>
            Effect.provide(
              Effect.flatMap(BookingCheckout, (checkout) =>
                checkout.recordMarketingConsent(session, input)
              ),
              capabilitiesLayer
            ),
          reviewParty: (session, input) =>
            Effect.provide(
              Effect.flatMap(BookingCheckout, (checkout) =>
                checkout.reviewParty(session, input)
              ),
              capabilitiesLayer
            )
        },
        giftCards: {
          reserve: (session, input) =>
            Effect.gen(function* () {
              const parties = yield* BookingParties
              const party = yield* parties.findForSession(session.id)
              const checkout = yield* BookingCheckout
              const preparation = yield* checkout.prepare(session, { now: input.now })
              if (!preparation.quote)
                return yield* new PaymentSettlementConflict({
                  code: 'quote_unconfirmable'
                })
              const cards = yield* GiftCardRedemptions
              return yield* cards.reserve({
                giftCardCode: input.giftCardCode,
                bookingPartyId: party.id,
                amountMinor: input.amountMinor,
                maximumAmountMinor: preparation.quote.totalMinor,
                expiresAt: preparation.quote.expiresAt,
                idempotencyKey: input.idempotencyKey,
                now: input.now
              })
            }).pipe(Effect.provide(capabilitiesLayer)),
          release: (session, input) =>
            Effect.gen(function* () {
              const parties = yield* BookingParties
              const party = yield* parties.findForSession(session.id)
              const cards = yield* GiftCardRedemptions
              return yield* cards.release({
                bookingPartyId: party.id,
                idempotencyKey: input.idempotencyKey,
                now: input.now
              })
            }).pipe(Effect.provide(capabilitiesLayer))
        },
        payments: {
          status: (session) =>
            Effect.gen(function* () {
              const parties = yield* BookingParties
              const party = yield* parties.findForSession(session.id)
              const payments = yield* PaymentSettlement
              return yield* payments.findForParty(party.id)
            }).pipe(Effect.provide(capabilitiesLayer)),
          methods: (session, input) =>
            Effect.gen(function* () {
              const checkout = yield* BookingCheckout
              const preparation = yield* checkout.prepare(session, {
                now: input.now
              })
              if (!preparation.quote)
                return {
                  state: 'disabled' as const,
                  methods: [],
                  giftCardMinor: 0,
                  externalPaymentMinor: 0
                }
              const parties = yield* BookingParties
              const party = yield* parties.findForSession(session.id)
              const cards = yield* GiftCardRedemptions
              const plan = yield* cards.planSettlement({
                bookingPartyId: party.id,
                quoteTotalMinor: preparation.quote.totalMinor,
                currency: preparation.quote.currency,
                now: input.now
              })
              if (plan.externalPaymentMinor === 0)
                return {
                  state: 'disabled' as const,
                  methods: [],
                  giftCardMinor: plan.giftCardMinor,
                  externalPaymentMinor: 0
                }
              const eligibility = yield* eligiblePaymentMethods({
                currency: preparation.quote.currency,
                amountMinor: plan.externalPaymentMinor,
                savedMethodCount: 0,
                wallets: input.wallets
              })
              return {
                ...eligibility,
                giftCardMinor: plan.giftCardMinor,
                externalPaymentMinor: plan.externalPaymentMinor
              }
            }).pipe(
              Effect.provide(paymentProviderLayer),
              Effect.provide(capabilitiesLayer)
            ),
          settle: (session, input) =>
            Effect.gen(function* () {
              const checkout = yield* BookingCheckout
              const preparation = yield* checkout.prepare(session, { now: input.now })
              if (!preparation.quote)
                return yield* new PaymentSettlementConflict({
                  code: 'quote_unconfirmable'
                })
              const party = yield* BookingParties
              const currentParty = yield* party.findForSession(session.id)
              const cards = yield* GiftCardRedemptions
              const plan = yield* cards.planSettlement({
                bookingPartyId: currentParty.id,
                quoteTotalMinor: preparation.quote.totalMinor,
                currency: preparation.quote.currency,
                now: input.now
              })
              if (plan.externalPaymentMinor === 0)
                return yield* new PaymentSettlementConflict({
                  code: 'external_payment_unexpected'
                })
              return yield* settleAcceptedPricingQuote({
                bookingPartyId: currentParty.id,
                bookingPartyVersion: currentParty.version,
                pricingQuoteId: preparation.quote.id,
                amountMinor: plan.externalPaymentMinor,
                currency: preparation.quote.currency,
                method: input.method,
                idempotencyKey: input.idempotencyKey,
                paymentMethodReference: input.paymentMethodReference,
                returnUrl: `${readyEnv.PUBLIC_SITE_ORIGIN.replace(/\/$/, '')}/${encodeURIComponent(session.merchantSlug)}/booking/session/${encodeURIComponent(session.id)}?payment_return=1`,
                now: input.now
              })
            }).pipe(
              Effect.provide(paymentProviderLayer),
              Effect.provide(capabilitiesLayer)
            )
        },
        confirmation: {
          read: (input) =>
            Effect.provide(
              Effect.flatMap(BookingConfirmation, (confirmation) =>
                confirmation.read(input)
              ),
              capabilitiesLayer
            ),
          confirm: (session, input) =>
            Effect.flatMap(
              Effect.provide(
                Effect.flatMap(BookingConfirmation, (confirmation) =>
                  confirmation.confirm(session, input)
                ),
                capabilitiesLayer
              ),
              (result) =>
                Effect.promise(async () => {
                  const principal = await customerAuth?.principal(request.headers)
                  await Effect.runPromise(
                    associateVerifiedBooking({
                      principal: principal ?? null,
                      confirmation: result,
                      now: input.now
                    }).pipe(Effect.provide(capabilitiesLayer))
                  )
                  return publishBookingWakeUp(readyEnv.BOOKING_EVENTS_QUEUE, result)
                })
            )
        },
        takeRead: (key) =>
          Effect.promise(() =>
            takeRate(readyEnv.RATE_LIMITER_BOOKING_READ, `read:${key}`, 120)
          ),
        takeWrite: (key) =>
          Effect.promise(() =>
            takeRate(readyEnv.RATE_LIMITER_BOOKING_WRITE, `write:${key}`, 30)
          ),
        fallback: (nextRequest) =>
          Effect.promise(() => Promise.resolve(startServer.fetch(nextRequest)))
      })
    )
  }
}
