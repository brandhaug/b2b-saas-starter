import startServer from '@tanstack/react-start/server-entry'
import { env as workerEnv } from 'cloudflare:workers'
import { Effect, Layer } from 'effect'
import {
  BookingSelection,
  BookingScheduling,
  BookingCheckout,
  BookingSessions,
  BookingConfirmation,
  enterBookingSession,
  LiveBookingSelection,
  LiveBookingScheduling,
  LiveBookingCheckout,
  LiveBookingSessions,
  LiveBookingConfirmation
} from '@b2b-saas-starter/capabilities'
import { layerFromD1 } from '@b2b-saas-starter/db'
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
    if (
      !env.DB ||
      !env.PUBLIC_SITE_ORIGIN ||
      !env.CONFIRMATION_SIGNING_KEYS ||
      !env.CONFIRMATION_CURRENT_KEY_ID
    ) {
      return new Response('Booking temporarily unavailable', {
        status: 503,
        headers: { 'retry-after': '60' }
      })
    }
    const sessionsLayer = LiveBookingSessions.pipe(Layer.provide(layerFromD1(env.DB)))
    const selectionLayer = LiveBookingSelection.pipe(Layer.provide(layerFromD1(env.DB)))
    const schedulingLayer = LiveBookingScheduling.pipe(
      Layer.provide(layerFromD1(env.DB))
    )
    const checkoutLayer = LiveBookingCheckout.pipe(Layer.provide(layerFromD1(env.DB)))
    let signingKeys: Readonly<Record<string, string>> = {}
    try {
      signingKeys = JSON.parse(env.CONFIRMATION_SIGNING_KEYS) as Record<string, string>
    } catch {
      /* handled by capability */
    }
    const confirmationLayer = LiveBookingConfirmation({
      currentKeyId: env.CONFIRMATION_CURRENT_KEY_ID,
      keys: signingKeys
    }).pipe(Layer.provide(layerFromD1(env.DB)))
    return Effect.runPromise(
      handleBookingSessionRequest(request, {
        publicSiteOrigin: env.PUBLIC_SITE_ORIGIN,
        enter: (input) => Effect.provide(enterBookingSession(input), sessionsLayer),
        authorize: (input) =>
          Effect.provide(
            Effect.flatMap(BookingSessions, (sessions) => sessions.authorize(input)),
            sessionsLayer
          ),
        selection: {
          load: (session) =>
            Effect.provide(
              Effect.flatMap(BookingSelection, (selection) => selection.load(session)),
              selectionLayer
            ),
          chooseProvider: (session, preference) =>
            Effect.provide(
              Effect.flatMap(BookingSelection, (selection) =>
                selection.chooseProvider(session, preference)
              ),
              selectionLayer
            ),
          chooseServices: (session, input) =>
            Effect.provide(
              Effect.flatMap(BookingSelection, (selection) =>
                selection.chooseServices(session, input)
              ),
              selectionLayer
            )
        },
        scheduling: {
          availability: (session, input) =>
            Effect.provide(
              Effect.flatMap(BookingScheduling, (scheduling) =>
                scheduling.availability(session, input)
              ),
              schedulingLayer
            ),
          hold: (session, input) =>
            Effect.provide(
              Effect.flatMap(BookingScheduling, (scheduling) =>
                scheduling.hold(session, input)
              ),
              schedulingLayer
            )
        },
        checkout: {
          saveCustomerDetails: (session, details, input) =>
            Effect.provide(
              Effect.flatMap(BookingCheckout, (checkout) =>
                checkout.saveCustomerDetails(session, details, input)
              ),
              checkoutLayer
            ),
          review: (session, input) =>
            Effect.provide(
              Effect.flatMap(BookingCheckout, (checkout) =>
                checkout.review(session, input)
              ),
              checkoutLayer
            )
        },
        confirmation: {
          confirm: (session, input) =>
            Effect.flatMap(
              Effect.provide(
                Effect.flatMap(BookingConfirmation, (confirmation) =>
                  confirmation.confirm(session, input)
                ),
                confirmationLayer
              ),
              (result) =>
                Effect.promise(() =>
                  publishBookingWakeUp(env.BOOKING_EVENTS_QUEUE, result)
                )
            )
        },
        takeRead: (key) =>
          Effect.promise(() =>
            takeRate(env.RATE_LIMITER_BOOKING_READ, `read:${key}`, 120)
          ),
        takeWrite: (key) =>
          Effect.promise(() =>
            takeRate(env.RATE_LIMITER_BOOKING_WRITE, `write:${key}`, 30)
          ),
        fallback: (nextRequest) =>
          Effect.promise(() => Promise.resolve(startServer.fetch(nextRequest)))
      })
    )
  }
}
