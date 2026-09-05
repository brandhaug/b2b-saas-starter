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

/** Companion discriminant for the 402 entitlement case, same `name`-only rules. */
export const PLAN_LIMIT_ERROR_NAME = 'PlanLimitError'

/**
 * Thrown when the workspace's plan refuses a create (token/webhook ceiling).
 * Only `name`/`message` survive the SSR boundary, so the upgrade guidance is
 * built here, where the calling form reads it.
 */
export class PlanLimitError extends Error {
  constructor(planId: string, limit: number) {
    super(
      `Your workspace's ${planId} plan allows at most ${limit} of this resource. ` +
        'Upgrade the plan on the Billing page to create more.'
    )
    this.name = PLAN_LIMIT_ERROR_NAME
  }
}

/** Companion discriminant for the 409 membership-refusal case, same rules. */
export const MEMBERSHIP_REFUSED_ERROR_NAME = 'MembershipRefusedError'

/**
 * Copy for the membership capability's machine refusal reasons
 * (`MEMBERSHIP_REFUSAL_REASONS` in `capabilities`), worded here rather than
 * imported: this module ships in the client bundle and the sentence is this
 * boundary's vocabulary, the same way `ForbiddenError` words `no_principal`.
 * Any other reason is a plugin refusal this boundary cannot classify without
 * sniffing message text, so it gets a sentence that is true for all of them:
 * the answer was no, and retrying will not change it.
 */
function membershipRefusalCopy(reason: string): string {
  switch (reason) {
    case 'not_a_member': {
      return 'That person is not a member of this workspace.'
    }
    case 'sole_owner': {
      return 'The workspace must keep an owner: transfer ownership to another member first.'
    }
    case 'owner_requires_owner': {
      return "Only a workspace owner can grant or change an owner's role."
    }
    default: {
      return 'The workspace refused this membership change.'
    }
  }
}

/**
 * Thrown when the workspace refuses a membership change on its merits — the
 * roster's own rules, not a permission the actor lacks (`ForbiddenError` is
 * that) and not a store outage. Carrying the copy here, at the server
 * boundary where the typed reason still exists, is what keeps the client on
 * the right side of the no-message-sniffing rule: by the time the rejection
 * reaches a form, only `name`/`message` survive, and the message is already
 * the explanation.
 */
export class MembershipRefusedError extends Error {
  constructor(reason: string) {
    super(membershipRefusalCopy(reason))
    this.name = MEMBERSHIP_REFUSED_ERROR_NAME
  }
}

/** Companion discriminant for the 409 user-admin refusal case, same rules. */
export const USER_ADMIN_REFUSED_ERROR_NAME = 'UserAdminRefusedError'

/** The constraint the `/admin` role editor keeps running into, worded once. */
const SYSTEM_AXIS_COPY =
  'The workspace refused this change: a System Admin can only change a membership in a workspace where they are also an admin or owner — the system role confers nothing inside a workspace.'

/**
 * Copy for the platform-user-admin capability's machine refusal reasons.
 * Everything else is the plugin refusing under the admin's own session — on
 * the cross-workspace role editor that is almost always the ADR 0054
 * constraint, and it is the one sentence that explains the surface's
 * standing promise.
 */
function userAdminRefusalCopy(reason: string): string {
  switch (reason) {
    case 'unknown_user': {
      return 'That account does not exist.'
    }
    case 'not_a_member':
    case 'not_a_member_after_write': {
      return 'That person is not a member of the named workspace.'
    }
    case 'cannot_impersonate_self': {
      return 'A System Admin cannot impersonate themself.'
    }
    case 'cannot_impersonate_admin': {
      return 'A System Admin cannot impersonate another admin.'
    }
    case 'not_impersonating': {
      return 'This session is not impersonating anyone.'
    }
    default: {
      return SYSTEM_AXIS_COPY
    }
  }
}

/**
 * Thrown when `/admin`'s plugin-backed change is refused on its merits. Same
 * reading as `MembershipRefusedError` one level down, with the system-axis
 * explanation as the fallback: every unclassified refusal on that surface is
 * the workspace declining the admin's standing, and the honest answer names
 * that rather than a generic "failed".
 */
export class UserAdminRefusedError extends Error {
  constructor(reason: string) {
    super(userAdminRefusalCopy(reason))
    this.name = USER_ADMIN_REFUSED_ERROR_NAME
  }
}
