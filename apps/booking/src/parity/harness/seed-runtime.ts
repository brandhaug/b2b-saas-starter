import { Effect } from 'effect'
import {
  BookingCheckout,
  BookingConfirmation,
  BookingScheduling,
  BookingSchedulingRejected,
  BookingSelection,
  BookingSessions,
  CapabilityUnavailable,
  SeedBookingCheckout,
  SeedBookingConfirmation,
  SeedBookingScheduling,
  SeedBookingSelection,
  SeedBookingSessions,
  emptySeedBookingCheckoutStore,
  emptySeedBookingConfirmationStore,
  emptySeedBookingSchedulingStore,
  emptySeedBookingSelectionStore,
  emptySeedBookingSessionStore,
  enterBookingSession,
  seedBookingSelectionEligibilityKey
} from '@b2b-saas-starter/capabilities/booking'
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
  const checkoutLayer = SeedBookingCheckout(checkout)
  const confirmationLayer = SeedBookingConfirmation(confirmation, {
    currentKeyId: 'parity',
    keys: { parity: 'deterministic-parity-confirmation-key' }
  })

  const snapshot = () => {
    const value = {
      sessions: mapValues(sessions.sessions),
      selections: mapValues(selection.selections),
      holds: mapValues(scheduling.holds),
      details: mapValues(checkout.details),
      appointments: mapValues(confirmation.appointments),
      access: mapValues(confirmation.access),
      outbox: mapValues(confirmation.outbox),
      providers: scenario.providers
    }
    let canonical = JSON.stringify(value)
    for (const sessionId of sessions.sessions.keys()) {
      canonical = canonical.replaceAll(sessionId, 'bsn_current')
    }
    canonical = canonical.replaceAll(/brt_[a-f0-9]{32}/g, 'brt_current')
    canonical = canonical.replaceAll(/hld_[a-z0-9_]+/g, 'hld_current')
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
            Effect.provide(
              Effect.flatMap(BookingSelection, (service) =>
                service.chooseProvider(session, preference, expectedVersion)
              ),
              selectionLayer
            ),
          chooseShop: (session, shopId, expectedVersion) =>
            Effect.provide(
              Effect.flatMap(BookingSelection, (service) =>
                service.chooseShop(session, shopId, expectedVersion)
              ),
              selectionLayer
            ),
          chooseServices: (session, input, expectedVersion) =>
            Effect.provide(
              Effect.flatMap(BookingSelection, (service) =>
                service.chooseServices(session, input, expectedVersion)
              ),
              selectionLayer
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
