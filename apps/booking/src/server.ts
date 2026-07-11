import startServer from '@tanstack/react-start/server-entry'
import { env as workerEnv } from 'cloudflare:workers'
import { Effect } from 'effect'
import {
  BookingSelection,
  BookingScheduling,
  BookingCheckout,
  BookingSessions,
  BookingConfirmation,
  enterBookingSession
} from '@b2b-saas-starter/capabilities/booking'
import { selectCapabilitiesLayer } from '@b2b-saas-starter/capabilities/runtime'
import { readTraceHeader, reportOperationalError } from '@b2b-saas-starter/logger'
import { handleBookingSessionRequest } from './lib/booking-session-http.ts'

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
        selection: {
          load: (session) =>
            Effect.provide(
              Effect.flatMap(BookingSelection, (selection) => selection.load(session)),
              capabilitiesLayer
            ),
          chooseProvider: (session, preference, expectedVersion) =>
            Effect.provide(
              Effect.flatMap(BookingSelection, (selection) =>
                selection.chooseProvider(session, preference, expectedVersion)
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
                Effect.promise(() =>
                  publishBookingWakeUp(readyEnv.BOOKING_EVENTS_QUEUE, result)
                )
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
