import { env as cloudflareEnv } from 'cloudflare:workers'
import { Cause, Effect, Exit, Option } from 'effect'
import {
  CapabilityUnavailable,
  selectCapabilitiesLayer,
  type CapabilityServices,
  type BookingProductEnv
} from '@b2b-saas-starter/capabilities'
import { CapabilityUnavailableError } from './capability-error'

export type { CapabilityServices }
export { CapabilityUnavailableError }

const bookingProductEnv = (): BookingProductEnv => {
  if (!cloudflareEnv.DB) {
    throw new CapabilityUnavailableError(
      'booking-product-database',
      'The D1 binding is unavailable.'
    )
  }
  return { DB: cloudflareEnv.DB }
}

const rethrowCapabilityFailure = (cause: Cause.Cause<unknown>): never => {
  const failure = Cause.findErrorOption(cause)
  if (Option.isSome(failure)) {
    const error = failure.value
    if (error instanceof CapabilityUnavailable) {
      throw new CapabilityUnavailableError(error.capability, error.reason)
    }
    throw error
  }
  throw Cause.squash(cause)
}

/**
 * Runs a Public Site Booking Product capability read against D1.
 */
export const runCapabilities = async <A, E>(
  effect: Effect.Effect<A, E, CapabilityServices>
): Promise<A> => {
  const exit = await Effect.runPromiseExit(
    Effect.provide(effect, selectCapabilitiesLayer(bookingProductEnv()))
  )
  if (Exit.isSuccess(exit)) return exit.value
  return rethrowCapabilityFailure(exit.cause)
}
