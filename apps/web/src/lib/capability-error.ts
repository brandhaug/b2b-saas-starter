import { UiError } from './ui-error'

// Diagnostic copy stays out of these errors entirely: uiErrorAdapter
// serializes code, allowlisted details and name, and `causeMessage`
// translates at the receiving locale. The message slot carries the code so a
// server log line still names the failure.
export const CAPABILITY_UNAVAILABLE_ERROR_NAME = 'CapabilityUnavailableError'

export class CapabilityUnavailableError extends UiError {
  constructor(capability: string, reason: string) {
    super('unavailable', {}, `unavailable: ${capability} (${reason})`)
    this.name = CAPABILITY_UNAVAILABLE_ERROR_NAME
  }
}

export const FORBIDDEN_ERROR_NAME = 'ForbiddenError'

export class ForbiddenError extends UiError {
  constructor(reason: string) {
    super(
      'forbidden',
      { reason: reason === 'no_principal' ? 'no_principal' : 'denied' },
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
const MEMBERSHIP_REFUSAL_REASONS = new Set([
  'not_a_member',
  'sole_owner',
  'owner_requires_owner'
])

export class MembershipRefusedError extends UiError {
  constructor(reason: string) {
    super(
      'membership_refused',
      { reason: MEMBERSHIP_REFUSAL_REASONS.has(reason) ? reason : 'refused' },
      'membership_refused'
    )
    this.name = 'MembershipRefusedError'
  }
}

/** The user-admin refusals the browser is allowed to distinguish. */
const USER_ADMIN_REFUSAL_REASONS = new Set([
  'unknown_user',
  'not_a_member',
  'not_a_member_after_write',
  'cannot_impersonate_self',
  'cannot_impersonate_admin',
  'not_impersonating'
])

export class UserAdminRefusedError extends UiError {
  constructor(reason: string) {
    super(
      'user_admin_refused',
      { reason: USER_ADMIN_REFUSAL_REASONS.has(reason) ? reason : 'refused' },
      'user_admin_refused'
    )
    this.name = 'UserAdminRefusedError'
  }
}
