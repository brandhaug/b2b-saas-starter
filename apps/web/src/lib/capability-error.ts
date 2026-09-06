import { UiError } from './ui-error'

// Diagnostic messages stay on the server. uiErrorAdapter carries codes and
// allowlisted details so causeMessage can translate at the receiving locale.
export const CAPABILITY_UNAVAILABLE_ERROR_NAME = 'CapabilityUnavailableError'

export class CapabilityUnavailableError extends UiError {
  constructor(capability: string, reason: string) {
    super(
      'unavailable',
      {},
      `This area is temporarily unavailable because the "${capability}" capability cannot reach its backing service (${reason}). ` +
        'The rest of the app keeps working. Check the database configuration and try again.'
    )
    this.name = CAPABILITY_UNAVAILABLE_ERROR_NAME
  }
}

export const FORBIDDEN_ERROR_NAME = 'ForbiddenError'

export class ForbiddenError extends UiError {
  constructor(reason: string) {
    super(
      'forbidden',
      { reason: reason === 'no_principal' ? 'no_principal' : 'denied' },
      reason === 'no_principal'
        ? 'You are not signed in to this workspace. Sign in again and retry.'
        : 'You do not have permission to do this in this workspace. Ask a workspace owner or admin.'
    )
    this.name = FORBIDDEN_ERROR_NAME
  }
}

export const PLAN_LIMIT_ERROR_NAME = 'PlanLimitError'

export class PlanLimitError extends UiError {
  constructor(planId: string, limit: number) {
    super(
      'plan_limit',
      { planId, limit },
      `Your workspace's ${planId} plan allows at most ${limit} of this resource. ` +
        'Upgrade the plan on the Billing page to create more.'
    )
    this.name = PLAN_LIMIT_ERROR_NAME
  }
}

export const MEMBERSHIP_REFUSED_ERROR_NAME = 'MembershipRefusedError'

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

export class MembershipRefusedError extends UiError {
  constructor(reason: string) {
    super(
      'membership_refused',
      {
        reason: ['not_a_member', 'sole_owner', 'owner_requires_owner'].includes(reason)
          ? reason
          : 'refused'
      },
      membershipRefusalCopy(reason)
    )
    this.name = MEMBERSHIP_REFUSED_ERROR_NAME
  }
}

export const USER_ADMIN_REFUSED_ERROR_NAME = 'UserAdminRefusedError'

const SYSTEM_AXIS_COPY =
  'The workspace refused this change: a System Admin can only change a membership in a workspace where they are also an admin or owner. The system role confers nothing inside a workspace.'

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

export class UserAdminRefusedError extends UiError {
  constructor(reason: string) {
    super(
      'user_admin_refused',
      {
        reason: [
          'unknown_user',
          'not_a_member',
          'not_a_member_after_write',
          'cannot_impersonate_self',
          'cannot_impersonate_admin',
          'not_impersonating'
        ].includes(reason)
          ? reason
          : 'refused'
      },
      userAdminRefusalCopy(reason)
    )
    this.name = USER_ADMIN_REFUSED_ERROR_NAME
  }
}
