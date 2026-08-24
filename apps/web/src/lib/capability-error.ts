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

/** Companion discriminant for the 403 case, on the same `name`-only rules. */
export const FORBIDDEN_ERROR_NAME = 'ForbiddenError'

/**
 * Thrown when the signed-in actor's workspace role does not cover the action.
 * `AuthorizationDenied` carries a machine reason and no message, and only
 * `name`/`message` survive the boundary — so the explanation has to be built
 * here, where the calling form reads it.
 */
export class ForbiddenError extends Error {
  constructor(reason: string) {
    super(
      reason === 'no_principal'
        ? 'You are not signed in to this workspace — sign in again and retry.'
        : 'You do not have permission to do this in this workspace. Ask a workspace owner or admin.'
    )
    this.name = FORBIDDEN_ERROR_NAME
  }
}

/** Companion discriminant for the 402 plan-limit case, on the same rules. */
export const PLAN_LIMIT_ERROR_NAME = 'PlanLimitError'

const RESOURCE_LABELS = {
  api_tokens: 'API tokens',
  webhook_endpoints: 'webhook endpoints',
  members: 'members'
} satisfies Record<string, string>

/**
 * Thrown when the workspace's plan does not cover the mutation. Built here for
 * the same reason as its siblings: only `name`/`message` survive the SSR
 * boundary, and the calling form shows the message verbatim.
 */
export class PlanLimitError extends Error {
  constructor(resource: string, limit: number, planId: string) {
    // An unknown resource falls back to the raw vocabulary rather than a
    // second lookup that could itself be undefined.
    const label =
      resource === 'api_tokens' ||
      resource === 'webhook_endpoints' ||
      resource === 'members'
        ? RESOURCE_LABELS[resource]
        : resource
    super(
      `Your workspace is already using all ${limit} ${label} included in the ${planId} plan. Upgrade or remove one to continue.`
    )
    this.name = PLAN_LIMIT_ERROR_NAME
  }
}
