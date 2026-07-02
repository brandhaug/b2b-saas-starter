/**
 * The single degraded-state discriminant: used as the error's `name` by the
 * constructor below and checked by `router.tsx`'s error component. Loader
 * errors cross the SSR boundary through TanStack's `defaultSerializeError`,
 * which keeps only `name`/`message` — so `name` is the one discriminant that
 * survives; never rely on `instanceof` or message text.
 *
 * This module must stay free of `cloudflare:workers` imports so the
 * client-bundled router can import it.
 */
export const CAPABILITY_UNAVAILABLE_ERROR_NAME = 'CapabilityUnavailableError'

/**
 * Thrown when a capability's backing service (D1, queue) fails. The router's
 * `defaultErrorComponent` shows `message` as a degraded-state notice instead
 * of a crash screen.
 */
export class CapabilityUnavailableError extends Error {
  constructor(capability: string, reason: string) {
    super(
      `This area is temporarily unavailable because the "${capability}" capability cannot reach its backing service (${reason}). ` +
        'The rest of the app keeps working — check the database configuration and try again.'
    )
    this.name = CAPABILITY_UNAVAILABLE_ERROR_NAME
  }
}
