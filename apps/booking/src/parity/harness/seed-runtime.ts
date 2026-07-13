import { Effect, Layer } from 'effect'
import {
  BookingCheckout,
  BookingConfirmation,
  BookingScheduling,
  BookingSchedulingRejected,
  BookingSelection,
  BookingSessions,
  BookingParties,
  CapabilityUnavailable,
  SeedBookingCheckout,
  SeedBookingConfirmation,
  SeedBookingScheduling,
  SeedBookingSelection,
  SeedBookingSessions,
  SeedBookingParties,
  emptySeedBookingCheckoutStore,
  emptySeedBookingConfirmationStore,
  emptySeedBookingSchedulingStore,
  emptySeedBookingSelectionStore,
  emptySeedBookingSessionStore,
  enterBookingSession,
  seedBookingSelectionEligibilityKey
} from '@b2b-saas-starter/capabilities/booking'
import { SeedPricingQuotes } from '@b2b-saas-starter/capabilities/pricing/testing'
import {
  eligiblePaymentMethods,
  emptySeedPaymentSettlementStore,
  PaymentProvider,
  PaymentSettlement,
  SeedPaymentSettlement,
  settleAcceptedPricingQuote,
  type PaymentProviderResult
} from '@b2b-saas-starter/capabilities/payments'
import { buildSeedBookingScenario } from '@b2b-saas-starter/capabilities/merchant-catalog'
import {
  handleBookingSessionRequest,
  readBookingSessionCapabilities
} from '../../lib/booking-session-http.ts'
import { createContentStore } from './content-store.ts'
import { createProviderDouble, type ProviderOutcome } from './provider-double.ts'
import type { ScenarioManifest } from './scenario-manifest.ts'

const mapValues = <A>(values: Map<string, A>) =>
  [...values.entries()].sort(([left], [right]) => left.localeCompare(right))

export const createSeedHarnessRuntime = (scenario: ScenarioManifest) => {
  const graph = buildSeedBookingScenario(scenario.clock.instant)
  const sessions = emptySeedBookingSessionStore({
    merchants: [{ id: graph.merchant.id, slug: graph.merchant.slug, published: true }]
  })
  const selection = emptySeedBookingSelectionStore({
    merchants: [
      {
        id: graph.merchant.id,
        slug: graph.merchant.slug,
        presentation: graph.merchant.plan
      }
    ],
    providers: graph.providers,
    services: graph.services,
    eligibility: graph.eligibility.map(seedBookingSelectionEligibilityKey)
  })
  const scheduling = emptySeedBookingSchedulingStore(graph, selection)
  const checkout = emptySeedBookingCheckoutStore(scheduling)
  const paymentStore = emptySeedPaymentSettlementStore()
  const paymentLayer = SeedPaymentSettlement(paymentStore)
  const paymentOutcomes = scenario.providers.payment as
    | Record<string, ProviderOutcome>
    | undefined
  const paymentDouble = createProviderDouble('payment', paymentOutcomes ?? {})
  const configuredPayment = paymentOutcomes?.['create-payment']
  const paymentProviderLayer = Layer.succeed(PaymentProvider)({
    configuration: {
      provider: 'deterministic',
      state:
        configuredPayment?.status === 'disabled'
          ? 'disabled'
          : configuredPayment?.status === 'needs-configuration'
            ? 'needs_configuration'
            : 'configured',
      methods:
        configuredPayment?.status === 'disabled' ||
        configuredPayment?.status === 'needs-configuration'
          ? []
          : ['card', 'apple_pay', 'google_pay', 'cash_app_pay', 'klarna']
    },
    settle: (input) =>
      Effect.promise(async () => {
        const outcome = await paymentDouble.invoke('create-payment', input)
        if (outcome.status === 'success' && outcome.value)
          return outcome.value as PaymentProviderResult
        if (outcome.status === 'success')
          return {
            outcome: 'succeeded',
            providerReference: `provider_${input.attempt.id}`,
            facts: [
              {
                kind: 'capture',
                amountMinor: input.payment.amountMinor,
                currency: input.payment.currency,
                providerReference: `capture_${input.payment.id}`,
                occurredAt: scenario.clock.instant
              }
            ]
          }
        return {
          outcome: 'failed',
          providerReference: `provider_${input.attempt.id}`,
          failureCode: 'code' in outcome ? outcome.code : 'provider_unavailable',
          facts: []
        }
      })
  })
  const confirmation = emptySeedBookingConfirmationStore(sessions, checkout)
  let sequence = 0
  const mutations: { sequence: number; method: string; pathname: string }[] = []
  const assets = createContentStore()
  const sessionsLayer = SeedBookingSessions(sessions, {
    newSessionId: () => `bsn_parity_${++sequence}`,
    newCapability: () => sequence.toString(16).padStart(64, '0')
  })
  const selectionLayer = SeedBookingSelection(selection)
  const schedulingLayer = SeedBookingScheduling(scheduling)
  const partiesLayer = SeedBookingParties(
    [],
    scheduling.requestSelections,
    scheduling.activeRequests,
    scheduling.partyRequests,
    scheduling.holds,
    sessions.parties,
    (sessionId, request) => {
      const current = selection.selections.get(sessionId)
      selection.selections.set(sessionId, {
        version: current?.version ?? 1,
        ...(current?.shopId ? { shopId: current.shopId } : {}),
        providerPreference: request?.providerPreference ?? null,
        primaryServiceId: request?.primaryServiceId ?? null,
        additionalServiceIds: [...(request?.additionalServiceIds ?? [])]
      })
    }
  )
  const pricingLayer = SeedPricingQuotes()
  const checkoutLayer = SeedBookingCheckout(checkout).pipe(
    Layer.provide(Layer.merge(partiesLayer, pricingLayer))
  )
  const confirmationLayer = SeedBookingConfirmation(confirmation, {
    currentKeyId: 'parity',
    keys: { parity: 'deterministic-parity-confirmation-key' }
  }).pipe(Layer.provide(paymentLayer))

  const snapshot = () => {
    const value = {
      sessions: mapValues(sessions.sessions),
      selections: mapValues(selection.selections),
      holds: mapValues(scheduling.holds),
      details: mapValues(checkout.details),
      appointments: mapValues(confirmation.appointments),
      access: mapValues(confirmation.access),
      outbox: mapValues(confirmation.outbox),
      payments: mapValues(paymentStore.payments),
      paymentAttempts: mapValues(paymentStore.attempts),
      providers: scenario.providers
    }
    let canonical = JSON.stringify(value)
    for (const sessionId of sessions.sessions.keys()) {
      canonical = canonical.replaceAll(sessionId, 'bsn_current')
    }
    const requestIds = new Map<string, string>()
    canonical = canonical.replace(/brq_[a-z0-9_]+/g, (requestId) => {
      const existing = requestIds.get(requestId)
      if (existing) return existing
      const normalized = `brq_${requestIds.size + 1}`
      requestIds.set(requestId, normalized)
      return normalized
    })
    canonical = canonical.replaceAll(/brt_[a-f0-9]{32}/g, 'brt_current')
    canonical = canonical.replaceAll(/hld_[a-z0-9_]+/g, 'hld_current')
    canonical = canonical.replaceAll(/pqt_[a-z0-9_]+/g, 'pqt_current')
    canonical = canonical.replaceAll(
      /payment-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
      'payment-current'
    )
    canonical = canonical.replaceAll(
      /trace_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
      'trace_current'
    )
    canonical = canonical.replaceAll(/[a-f0-9]{64}/g, '<credential-hash>')
    return JSON.parse(canonical) as unknown
  }

  const handle = async (
    request: Request,
    fallback: (request: Request) => Promise<Response>
  ) => {
    const pathname = new URL(request.url).pathname
    const segments = pathname.split('/').filter(Boolean)
    if (scenario.journey === 'deliberate-blank' && segments.length === 2) {
      return fallback(request)
    }
    const sessionLocator = segments[2] === 'session' ? segments[3] : undefined
    const routeSession = [...sessions.sessions.values()].find(
      (session) => session.routeId === sessionLocator
    )
    if (sessionLocator && !sessions.sessions.has(sessionLocator) && !routeSession) {
      const candidates = readBookingSessionCapabilities(request.headers.get('cookie'))
      const presented =
        candidates.find((candidate) => candidate.sessionId === sessionLocator) ??
        candidates[0]
      if (presented) {
        const digest = await crypto.subtle.digest(
          'SHA-256',
          new TextEncoder().encode(presented.capability)
        )
        sessions.sessions.set(presented.sessionId, {
          id: presented.sessionId,
          ...(sessionLocator.startsWith('brt_') ? { routeId: sessionLocator } : {}),
          merchantId: graph.merchant.id,
          merchantSlug: graph.merchant.slug,
          checkoutPath: 'pay_in_person',
          lifecycle: 'active',
          createdAt: scenario.clock.instant,
          lastActivityAt: scenario.clock.instant,
          idleExpiresAt: new Date(
            Date.parse(scenario.clock.instant) + 30 * 60_000
          ).toISOString(),
          absoluteExpiresAt: new Date(
            Date.parse(scenario.clock.instant) + 2 * 60 * 60_000
          ).toISOString(),
          capabilityHash: Array.from(new Uint8Array(digest), (byte) =>
            byte.toString(16).padStart(2, '0')
          ).join('')
        })
        sessions.parties.set(presented.sessionId, {
          id: `bpt_${presented.sessionId}`,
          bookingSessionId: presented.sessionId,
          requestId: `brq_${presented.sessionId}`,
          shopId: `shp_${graph.merchant.id}`,
          locale: scenario.locale
        })
      }
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      mutations.push({
        sequence: mutations.length + 1,
        method: request.method,
        pathname
      })
    }
    return Effect.runPromise(
      handleBookingSessionRequest(request, {
        publicSiteOrigin: new URL(request.url).origin,
        now: () => scenario.clock.instant,
        enter: (input) => Effect.provide(enterBookingSession(input), sessionsLayer),
        authorize: (input) =>
          Effect.provide(
            Effect.flatMap(BookingSessions, (service) => service.authorize(input)),
            sessionsLayer
          ),
        authorizeRoute: (input) =>
          Effect.provide(
            Effect.flatMap(BookingSessions, (service) => service.authorizeRoute(input)),
            sessionsLayer
          ),
        selection: {
          load: (session) => {
            if (scenario.journey === 'selection-loading') return Effect.never
            if (scenario.journey === 'selection-error') {
              return Effect.fail(
                new CapabilityUnavailable({
                  capability: 'booking-selection',
                  reason: 'deterministic_failure'
                })
              )
            }
            return Effect.provide(
              Effect.flatMap(BookingSelection, (service) => service.load(session)),
              selectionLayer
            )
          },
          chooseProvider: (session, preference, expectedVersion) =>
            Effect.gen(function* () {
              const journey = yield* Effect.provide(
                Effect.flatMap(BookingSelection, (service) =>
                  service.chooseProvider(session, preference, expectedVersion)
                ),
                selectionLayer
              )
              const party = yield* Effect.orDie(
                Effect.provide(
                  Effect.flatMap(BookingParties, (service) =>
                    service.findForSession(session.id)
                  ),
                  partiesLayer
                )
              )
              yield* Effect.orDie(
                Effect.provide(
                  Effect.flatMap(BookingParties, (service) =>
                    service.updateRequest(
                      party.id,
                      party.activeRequestId!,
                      {
                        providerPreference: preference.kind,
                        providerId:
                          preference.kind === 'specific' ? preference.providerId : null
                      },
                      party.version,
                      scenario.clock.instant
                    )
                  ),
                  partiesLayer
                )
              )
              return journey
            }),
          chooseShop: (session, shopId, expectedVersion) =>
            Effect.provide(
              Effect.flatMap(BookingSelection, (service) =>
                service.chooseShop(session, shopId, expectedVersion)
              ),
              selectionLayer
            ),
          chooseServices: (session, input, expectedVersion) =>
            Effect.gen(function* () {
              const journey = yield* Effect.provide(
                Effect.flatMap(BookingSelection, (service) =>
                  service.chooseServices(session, input, expectedVersion)
                ),
                selectionLayer
              )
              const party = yield* Effect.orDie(
                Effect.provide(
                  Effect.flatMap(BookingParties, (service) =>
                    service.findForSession(session.id)
                  ),
                  partiesLayer
                )
              )
              yield* Effect.orDie(
                Effect.provide(
                  Effect.flatMap(BookingParties, (service) =>
                    service.updateRequest(
                      party.id,
                      party.activeRequestId!,
                      {
                        primaryServiceId: input.primaryServiceId,
                        serviceIds: [
                          input.primaryServiceId,
                          ...input.additionalServiceIds
                        ].filter((id): id is string => id !== null)
                      },
                      party.version,
                      scenario.clock.instant
                    )
                  ),
                  partiesLayer
                )
              )
              return journey
            })
        },
        parties: {
          load: (session) =>
            Effect.provide(
              Effect.flatMap(BookingParties, (service) =>
                service.findForSession(session.id)
              ),
              partiesLayer
            ),
          add: (partyId, version, now) =>
            Effect.provide(
              Effect.flatMap(BookingParties, (service) =>
                service.addRequest(partyId, version, now)
              ),
              partiesLayer
            ),
          remove: (partyId, requestId, version, now) =>
            Effect.provide(
              Effect.flatMap(BookingParties, (service) =>
                service.removeRequest(partyId, requestId, version, now)
              ),
              partiesLayer
            ),
          reorder: (partyId, requestIds, version, now) =>
            Effect.provide(
              Effect.flatMap(BookingParties, (service) =>
                service.reorderRequests(partyId, requestIds, version, now)
              ),
              partiesLayer
            ),
          update: (partyId, requestId, material, version, now) =>
            Effect.provide(
              Effect.flatMap(BookingParties, (service) =>
                service.updateRequest(partyId, requestId, material, version, now)
              ),
              partiesLayer
            ),
          activate: (partyId, requestId, version, now) =>
            Effect.provide(
              Effect.flatMap(BookingParties, (service) =>
                service.activateRequest(partyId, requestId, version, now)
              ),
              partiesLayer
            )
        },
        scheduling: {
          availability: (session, input) => {
            if (scenario.journey === 'scheduling-loading') return Effect.never
            if (scenario.journey === 'scheduling-unavailable') {
              return Effect.fail(
                new CapabilityUnavailable({
                  capability: 'booking-scheduling',
                  reason: 'deterministic_failure'
                })
              )
            }
            const result = Effect.provide(
              Effect.flatMap(BookingScheduling, (service) =>
                service.availability(session, input)
              ),
              schedulingLayer
            )
            return scenario.journey === 'scheduling-empty'
              ? Effect.map(result, (availability) => ({
                  ...availability,
                  slots: []
                }))
              : result
          },
          hold: (session, input) => {
            if (scenario.journey === 'scheduling-conflict') {
              return Effect.fail(
                new BookingSchedulingRejected({
                  reason: 'slot_lost',
                  message: 'That time was just booked'
                })
              )
            }
            return Effect.provide(
              Effect.flatMap(BookingScheduling, (service) =>
                service.hold(session, input)
              ),
              schedulingLayer
            )
          },
          holdParty: (session, input) => {
            if (scenario.fixture.data.groupConflict === true)
              return Effect.fail(
                new BookingSchedulingRejected({
                  reason: 'slot_lost',
                  message: 'That time was just booked'
                })
              )
            return Effect.provide(
              Effect.flatMap(BookingScheduling, (service) =>
                service.holdParty(session, input)
              ),
              schedulingLayer
            )
          },
          release: (session) =>
            Effect.provide(
              Effect.flatMap(BookingScheduling, (service) => service.release(session)),
              schedulingLayer
            )
        },
        checkout: {
          saveCustomerDetails: (session, details, input) =>
            Effect.provide(
              Effect.flatMap(BookingCheckout, (service) =>
                service.saveCustomerDetails(session, details, input)
              ),
              checkoutLayer
            ),
          review: (session, input) =>
            Effect.provide(
              Effect.flatMap(BookingCheckout, (service) =>
                service.review(session, input)
              ),
              checkoutLayer
            ),
          prepare: (session, input) =>
            Effect.provide(
              Effect.flatMap(BookingCheckout, (service) =>
                service.prepare(session, input)
              ),
              checkoutLayer
            ),
          acceptQuote: (session, input) =>
            Effect.provide(
              Effect.flatMap(BookingCheckout, (service) =>
                service.acceptQuote(session, input)
              ),
              checkoutLayer
            ),
          acceptPolicy: (session, input) =>
            Effect.provide(
              Effect.flatMap(BookingCheckout, (service) =>
                service.acceptPolicy(session, input)
              ),
              checkoutLayer
            ),
          recordMarketingConsent: (session, input) =>
            Effect.provide(
              Effect.flatMap(BookingCheckout, (service) =>
                service.recordMarketingConsent(session, input)
              ),
              checkoutLayer
            ),
          reviewParty: (session, input) =>
            Effect.provide(
              Effect.flatMap(BookingCheckout, (service) =>
                service.reviewParty(session, input)
              ),
              checkoutLayer
            )
        },
        payments: {
          status: (session) =>
            Effect.gen(function* () {
              const parties = yield* BookingParties
              const party = yield* parties.findForSession(session.id)
              const payments = yield* PaymentSettlement
              return yield* payments.findForParty(party.id)
            }).pipe(Effect.provide(partiesLayer), Effect.provide(paymentLayer)),
          methods: (_session, input) =>
            Effect.map(
              eligiblePaymentMethods({
                currency: graph.merchant.currency,
                amountMinor: 5000,
                savedMethodCount: 0,
                wallets: input.wallets
              }).pipe(Effect.provide(paymentProviderLayer)),
              (eligibility) => ({
                ...eligibility,
                giftCardMinor: 0,
                externalPaymentMinor: 5000
              })
            ),
          settle: (session, input) =>
            Effect.gen(function* () {
              const checkoutService = yield* BookingCheckout
              const preparation = yield* checkoutService.prepare(session, {
                now: input.now
              })
              if (!preparation.quote)
                return yield* new CapabilityUnavailable({
                  capability: 'payment-settlement',
                  reason: 'quote_unavailable'
                })
              const parties = yield* BookingParties
              const party = yield* parties.findForSession(session.id)
              paymentStore.acceptedQuotes.set(preparation.quote.id, {
                bookingPartyId: party.id,
                partyVersion: party.version,
                amountMinor: preparation.quote.totalMinor,
                currency: preparation.quote.currency,
                expiresAt: preparation.quote.expiresAt
              })
              return yield* settleAcceptedPricingQuote({
                bookingPartyId: party.id,
                bookingPartyVersion: party.version,
                pricingQuoteId: preparation.quote.id,
                amountMinor: preparation.quote.totalMinor,
                currency: preparation.quote.currency,
                method: input.method,
                idempotencyKey: input.idempotencyKey,
                paymentMethodReference: input.paymentMethodReference,
                returnUrl: `http://booking.test/${session.merchantSlug}/booking/session/${session.id}?payment_return=1`,
                now: input.now
              })
            }).pipe(
              Effect.provide(checkoutLayer),
              Effect.provide(partiesLayer),
              Effect.provide(paymentLayer),
              Effect.provide(paymentProviderLayer)
            )
        },
        confirmation: {
          read: (input) =>
            Effect.provide(
              Effect.flatMap(BookingConfirmation, (service) => service.read(input)),
              confirmationLayer
            ),
          confirm: (session, input) =>
            Effect.provide(
              Effect.flatMap(BookingConfirmation, (service) =>
                service.confirm(session, input)
              ),
              confirmationLayer
            )
        },
        takeRead: () => Effect.succeed(true),
        takeWrite: () => Effect.succeed(true),
        fallback: (nextRequest) => Effect.promise(() => fallback(nextRequest))
      })
    )
  }

  return { handle, snapshot, mutations: () => structuredClone(mutations), assets }
}

export const createSeedHarnessController = (
  scenario: ScenarioManifest,
  secret: string
) => {
  let runtime = createSeedHarnessRuntime(scenario)
  const providers = new Map(
    Object.entries(scenario.providers).map(([name, outcomes]) => [
      name,
      createProviderDouble(name, outcomes as Record<string, ProviderOutcome>)
    ])
  )
  const authorized = (request: Request) =>
    request.headers.get('authorization') === `Bearer ${secret}`
  const response = (value: unknown) =>
    Response.json(value, { headers: { 'cache-control': 'no-store' } })

  return {
    async handle(
      request: Request,
      fallback: (request: Request) => Promise<Response>
    ): Promise<Response> {
      const url = new URL(request.url)
      if (!url.pathname.startsWith('/__parity/')) {
        return runtime.handle(request, fallback)
      }
      if (!authorized(request)) return new Response('Not found', { status: 404 })
      if (url.pathname === '/__parity/reset' && request.method === 'POST') {
        runtime = createSeedHarnessRuntime(scenario)
        return new Response(null, { status: 204 })
      }
      if (url.pathname === '/__parity/snapshot' && request.method === 'GET') {
        return response(runtime.snapshot())
      }
      if (url.pathname === '/__parity/mutations' && request.method === 'GET') {
        return response(runtime.mutations())
      }
      if (url.pathname === '/__parity/assets' && request.method === 'PUT') {
        const identity = await runtime.assets.put(
          new Uint8Array(await request.arrayBuffer())
        )
        return response({ identity })
      }
      const asset = url.pathname.match(/^\/__parity\/assets\/(sha256:[a-f0-9]{64})$/)
      if (asset && request.method === 'GET') return runtime.assets.response(asset[1]!)
      const provider = url.pathname.match(/^\/__parity\/providers\/([^/]+)\/([^/]+)$/)
      if (provider && request.method === 'POST') {
        const double = providers.get(decodeURIComponent(provider[1]!))
        if (!double) return new Response('Not found', { status: 404 })
        return response(
          await double.invoke(
            decodeURIComponent(provider[2]!),
            await request.json().catch(() => null)
          )
        )
      }
      return new Response('Not found', { status: 404 })
    },
    snapshot: () => runtime.snapshot(),
    mutations: () => runtime.mutations()
  }
}
