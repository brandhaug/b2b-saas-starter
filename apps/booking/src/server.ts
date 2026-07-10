import startServer from '@tanstack/react-start/server-entry'
import { Effect, Layer } from 'effect'
import {
  BookingSessions,
  enterBookingSession,
  LiveBookingSessions
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
    if (!passedEnv?.DB || !passedEnv.PUBLIC_SITE_ORIGIN) {
      return new Response('Booking temporarily unavailable', {
        status: 503,
        headers: { 'retry-after': '60' }
      })
    }
    const env = passedEnv
    const sessionsLayer = LiveBookingSessions.pipe(Layer.provide(layerFromD1(env.DB)))
    return Effect.runPromise(
      handleBookingSessionRequest(request, {
        publicSiteOrigin: env.PUBLIC_SITE_ORIGIN,
        enter: (input) => Effect.provide(enterBookingSession(input), sessionsLayer),
        authorize: (input) =>
          Effect.provide(
            Effect.flatMap(BookingSessions, (sessions) => sessions.authorize(input)),
            sessionsLayer
          ),
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
