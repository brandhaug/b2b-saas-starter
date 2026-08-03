import startServer from '@tanstack/react-start/server-entry'
import { env as workerEnv } from 'cloudflare:workers'
import { Effect, Schema } from 'effect'
import {
  BookingSelection,
  BookingScheduling,
  BookingCheckout,
  BookingSessions,
  BookingConfirmation,
  BookingCancellationRejected,
  BookingCancellations,
  BookingRescheduleRejected,
  BookingRescheduling,
  BookingParties,
  enterBookingSession
} from '@b2b-saas-starter/capabilities/booking'
import {
  associateVerifiedBooking,
  CustomerIdentity
} from '@b2b-saas-starter/capabilities/customer-identity'
import { selectCapabilitiesLayer } from '@b2b-saas-starter/capabilities/runtime'
import type { QueueWakeup } from '@b2b-saas-starter/capabilities/foundation'
import type { BookingEventsWakeup } from '@b2b-saas-starter/capabilities/notifications'
import { ShopTopology } from '@b2b-saas-starter/capabilities/merchant-catalog'
import { WalkIns } from '@b2b-saas-starter/capabilities/walk-ins'
import { PaymentProviderResult } from '@b2b-saas-starter/capabilities/payments'
import { readTraceHeader, reportOperationalError } from '@b2b-saas-starter/logger'
import { handleBookingSessionRequest } from './lib/booking-session-http.ts'
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
    readonly send: (message: BookingEventsWakeup | QueueWakeup) => Promise<unknown>
  }
  readonly CONFIRMATION_SIGNING_KEYS: string
  readonly CONFIRMATION_CURRENT_KEY_ID: string
  readonly CUSTOMER_DIRECTORY_FINGERPRINT_KEY: string
  readonly OPERATIONAL_MESSAGING_DESTINATION_ENCRYPTION_KEY?: string
  readonly OPERATIONAL_MESSAGING_DESTINATION_FINGERPRINT_KEY?: string
  readonly OPERATIONAL_MESSAGING_DESTINATION_KEY_VERSION?: string
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

const PaymentProviderCallback = Schema.Struct({
  paymentId: Schema.String.check(Schema.isMinLength(1)),
  providerEventId: Schema.String.check(Schema.isMinLength(1)),
  facts: PaymentProviderResult.fields.facts
})

const hashRescheduleCapability = async (capability: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(capability))
    ),
    (byte) => byte.toString(16).padStart(2, '0')
  ).join('')

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

export const publishBookingWakeUp = async <
  A extends {
    readonly outboxId?: string | undefined
    readonly outboxIds?: readonly string[] | undefined
    readonly notificationIntentIds?: readonly string[] | undefined
  }
>(
  queue: BookingWorkerEnv['BOOKING_EVENTS_QUEUE'],
  result: A
): Promise<A> => {
  if (!queue) return result
  const outboxIds = result.outboxIds ?? (result.outboxId ? [result.outboxId] : [])
  await Promise.allSettled([
    ...outboxIds.map((outboxId) =>
      queue.send({ version: 1, kind: 'booking-outbox', outboxId })
    ),
    ...(result.notificationIntentIds ?? []).map((intentId) =>
      queue.send({ version: 1, kind: 'notification-intent', intentId })
    )
  ])
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
      ...(!env.CONFIRMATION_CURRENT_KEY_ID ? ['CONFIRMATION_CURRENT_KEY_ID'] : []),
      ...(!env.CUSTOMER_DIRECTORY_FINGERPRINT_KEY
        ? ['CUSTOMER_DIRECTORY_FINGERPRINT_KEY']
        : [])
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
    const capabilitiesLayer = selectCapabilitiesLayer(
      {
        ...readyEnv,
        REQUIRE_CUSTOMER_DIRECTORY_FINGERPRINT_KEY: true
      },
      {
        confirmationKeyring: {
          currentKeyId: readyEnv.CONFIRMATION_CURRENT_KEY_ID,
          keys: signingKeys
        }
      }
    )
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
          recordOperationalMessagingPermission: (session, input) =>
            Effect.provide(
              Effect.flatMap(BookingCheckout, (checkout) =>
                checkout.recordOperationalMessagingPermission(session, input)
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
        cancellations: {
          cancel: (input) =>
            Effect.flatMap(
              Effect.promise(async () => {
                const merchant = await readyEnv.DB.prepare(
                  'SELECT id FROM merchants WHERE slug = ? LIMIT 1'
                )
                  .bind(input.merchantSlug)
                  .first<{ id: string }>()
                if (!merchant) return null
                if (input.scope.kind === 'appointment')
                  return {
                    merchantId: merchant.id,
                    scope: input.scope
                  } as const
                const access = await readyEnv.DB.prepare(
                  `SELECT confirmation_access.booking_party_id AS bookingPartyId
                   FROM confirmation_access
                   JOIN appointments ON appointments.id = confirmation_access.appointment_id
                   WHERE confirmation_access.route_id = ? AND appointments.merchant_id = ?
                   LIMIT 1`
                )
                  .bind(input.scope.confirmationRouteId, merchant.id)
                  .first<{ bookingPartyId: string | null }>()
                return access?.bookingPartyId
                  ? ({
                      merchantId: merchant.id,
                      scope: {
                        kind: 'party' as const,
                        bookingPartyId: access.bookingPartyId
                      }
                    } as const)
                  : null
              }),
              (resolved) =>
                resolved
                  ? Effect.provide(
                      Effect.flatMap(BookingCancellations, (cancellations) =>
                        cancellations.cancel({
                          merchantId: resolved.merchantId,
                          scope: resolved.scope,
                          idempotencyKey: input.idempotencyKey,
                          reason: input.reason,
                          now: input.now
                        })
                      ),
                      capabilitiesLayer
                    )
                  : Effect.fail(
                      new BookingCancellationRejected({
                        code:
                          input.scope.kind === 'appointment'
                            ? 'appointment_not_found'
                            : 'party_not_found'
                      })
                    )
            ).pipe(
              Effect.flatMap((result) =>
                Effect.promise(() =>
                  publishBookingWakeUp(readyEnv.BOOKING_EVENTS_QUEUE, result)
                )
              )
            )
        },
        rescheduling: {
          execute: (input) =>
            Effect.gen(function* () {
              const merchant = yield* Effect.promise(() =>
                readyEnv.DB.prepare('SELECT id FROM merchants WHERE slug = ? LIMIT 1')
                  .bind(input.merchantSlug)
                  .first<{ id: string }>()
              )
              if (!merchant)
                return yield* new BookingRescheduleRejected({
                  code: 'appointment_not_found'
                })
              const capabilityHash = yield* Effect.promise(() =>
                hashRescheduleCapability(input.command.capability)
              )
              const service = yield* BookingRescheduling
              switch (input.command.action) {
                case 'begin':
                  return yield* service.begin({
                    merchantId: merchant.id,
                    appointmentId: input.appointmentId,
                    capabilityHash,
                    expiresAt: input.command.expiresAt,
                    now: input.now
                  })
                case 'prepare':
                  return yield* service.prepare({
                    sessionId: input.command.sessionId,
                    capabilityHash,
                    replacement: input.command.replacement,
                    now: input.now
                  })
                case 'commit':
                  return yield* Effect.flatMap(
                    service.commit({
                      merchantId: merchant.id,
                      sessionId: input.command.sessionId,
                      capabilityHash,
                      idempotencyKey: input.command.idempotencyKey,
                      now: input.now
                    }),
                    (result) =>
                      Effect.promise(() =>
                        publishBookingWakeUp(readyEnv.BOOKING_EVENTS_QUEUE, result)
                      )
                  )
              }
            }).pipe(Effect.provide(capabilitiesLayer))
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
