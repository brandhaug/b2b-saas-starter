import { UiError } from './ui-error'

// Diagnostic copy stays out of these errors entirely: uiErrorAdapter
// serializes code, allowlisted details and name, and `causeMessage`
// translates at the receiving locale. The message slot carries the code so a
// server log line still names the failure.
//
// Each refusal discriminant states its reasons once, as a `const` tuple with
// the fallback reason last. The tuple narrows an untrusted reason string for
// the details allowlist and is the type `cause-message.ts` keys its translated
// copy off — a reason added here without a translation there is a type error.

/** Narrows an untrusted reason to the discriminant's vocabulary. */
function narrowReason<Reason extends string>(
  reasons: ReadonlyArray<Reason>,
  fallback: Reason,
  value: string
): Reason {
  return reasons.find((reason) => reason === value) ?? fallback
}

export const CAPABILITY_UNAVAILABLE_ERROR_NAME = 'CapabilityUnavailableError'

export class CapabilityUnavailableError extends UiError {
  constructor(capability: string, reason: string) {
    super('unavailable', {}, `unavailable: ${capability} (${reason})`)
    this.name = CAPABILITY_UNAVAILABLE_ERROR_NAME
  }
}

export const FORBIDDEN_ERROR_NAME = 'ForbiddenError'

// oxlint-disable-next-line effect/noAs -- `as const`, not a type assertion
const forbiddenReasons = ['no_principal', 'denied'] as const

export type ForbiddenReason = (typeof forbiddenReasons)[number]

export class ForbiddenError extends UiError {
  constructor(reason: string) {
    super(
      'forbidden',
      { reason: narrowReason(forbiddenReasons, 'denied', reason) },
      'forbidden'
    )
    this.name = FORBIDDEN_ERROR_NAME
  }
}

export class PlanLimitError extends UiError {
  constructor(planId: string, limit: number) {
    super('plan_limit', { planId, limit }, 'plan_limit')
    this.name = 'PlanLimitError'
  }
}

/** The membership refusals the browser is allowed to distinguish. */
// oxlint-disable-next-line effect/noAs -- `as const`, not a type assertion
const membershipRefusalReasons = [
  'not_a_member',
  'sole_owner',
  'owner_requires_owner',
  'refused'
] as const

export type MembershipRefusalReason = (typeof membershipRefusalReasons)[number]

export class MembershipRefusedError extends UiError {
  constructor(reason: string) {
    super(
      'membership_refused',
      { reason: narrowReason(membershipRefusalReasons, 'refused', reason) },
      'membership_refused'
    )
    this.name = 'MembershipRefusedError'
  }
}

/** The user-admin refusals the browser is allowed to distinguish. */
// oxlint-disable-next-line effect/noAs -- `as const`, not a type assertion
const userAdminRefusalReasons = [
  'unknown_user',
  'not_a_member',
  'not_a_member_after_write',
  'cannot_impersonate_self',
  'cannot_impersonate_admin',
  'not_impersonating',
  'refused'
] as const

export type UserAdminRefusalReason = (typeof userAdminRefusalReasons)[number]

export class UserAdminRefusedError extends UiError {
  constructor(reason: string) {
    super(
      'user_admin_refused',
      { reason: narrowReason(userAdminRefusalReasons, 'refused', reason) },
      'user_admin_refused'
    )
    this.name = 'UserAdminRefusedError'
  }
}

/**
 * The request's session is not what an impersonation action needs: starting
 * one from a session that is already an impersonation (no nesting — the admin
 * cookie holds one token), replaying a delivery while impersonating, or
 * stopping an impersonation from an ordinary session.
 */
// oxlint-disable-next-line effect/noAs -- `as const`, not a type assertion
const impersonationStateReasons = [
  'nested',
  'replay_blocked',
  'not_impersonating'
] as const

export type ImpersonationStateReason = (typeof impersonationStateReasons)[number]

export class ImpersonationStateError extends UiError {
  constructor(reason: ImpersonationStateReason) {
    super('impersonation_state', { reason }, 'impersonation_state')
    this.name = 'ImpersonationStateError'
  }
}

/** The workspace-creation gate's refusal for an unverified mailbox. */
export class UnverifiedEmailError extends UiError {
  constructor() {
    super('unverified_email', {}, 'unverified_email')
    this.name = 'UnverifiedEmailError'
  }
}
