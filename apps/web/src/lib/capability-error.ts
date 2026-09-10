import { UiError } from './ui-error'

// Diagnostic messages stay on the server. uiErrorAdapter carries codes and
// allowlisted details so causeMessage can translate at the receiving locale.
//
// Each refusal discriminant states its reasons once, as a `const` tuple with
// the fallback reason last. The tuple narrows an untrusted reason string for
// the details allowlist, keys the English diagnostic copy below, and is the
// type `cause-message.ts` keys its translated copy off — a reason added here
// without a translation there is a type error.

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

// oxlint-disable-next-line effect/noAs -- `as const`, not a type assertion
const forbiddenReasons = ['no_principal', 'denied'] as const

export type ForbiddenReason = (typeof forbiddenReasons)[number]

const FORBIDDEN_COPY = {
  no_principal: 'You are not signed in to this workspace. Sign in again and retry.',
  denied:
    'You do not have permission to do this in this workspace. Ask a workspace owner or admin.'
} satisfies Readonly<Record<ForbiddenReason, string>>

export class ForbiddenError extends UiError {
  constructor(reason: string) {
    const narrowed = narrowReason(forbiddenReasons, 'denied', reason)
    super('forbidden', { reason: narrowed }, FORBIDDEN_COPY[narrowed])
    this.name = FORBIDDEN_ERROR_NAME
  }
}

const PLAN_LIMIT_ERROR_NAME = 'PlanLimitError'

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

const MEMBERSHIP_REFUSED_ERROR_NAME = 'MembershipRefusedError'

// oxlint-disable-next-line effect/noAs -- `as const`, not a type assertion
const membershipRefusalReasons = [
  'not_a_member',
  'sole_owner',
  'owner_requires_owner',
  'refused'
] as const

export type MembershipRefusalReason = (typeof membershipRefusalReasons)[number]

const MEMBERSHIP_REFUSAL_COPY = {
  not_a_member: 'That person is not a member of this workspace.',
  sole_owner:
    'The workspace must keep an owner: transfer ownership to another member first.',
  owner_requires_owner: "Only a workspace owner can grant or change an owner's role.",
  refused: 'The workspace refused this membership change.'
} satisfies Readonly<Record<MembershipRefusalReason, string>>

export class MembershipRefusedError extends UiError {
  constructor(reason: string) {
    const narrowed = narrowReason(membershipRefusalReasons, 'refused', reason)
    super('membership_refused', { reason: narrowed }, MEMBERSHIP_REFUSAL_COPY[narrowed])
    this.name = MEMBERSHIP_REFUSED_ERROR_NAME
  }
}

const USER_ADMIN_REFUSED_ERROR_NAME = 'UserAdminRefusedError'

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

const SYSTEM_AXIS_COPY =
  'The workspace refused this change: a System Admin can only change a membership in a workspace where they are also an admin or owner. The system role confers nothing inside a workspace.'

const USER_ADMIN_REFUSAL_COPY = {
  unknown_user: 'That account does not exist.',
  not_a_member: 'That person is not a member of the named workspace.',
  not_a_member_after_write: 'That person is not a member of the named workspace.',
  cannot_impersonate_self: 'A System Admin cannot impersonate themself.',
  cannot_impersonate_admin: 'A System Admin cannot impersonate another admin.',
  not_impersonating: 'This session is not impersonating anyone.',
  refused: SYSTEM_AXIS_COPY
} satisfies Readonly<Record<UserAdminRefusalReason, string>>

export class UserAdminRefusedError extends UiError {
  constructor(reason: string) {
    const narrowed = narrowReason(userAdminRefusalReasons, 'refused', reason)
    super('user_admin_refused', { reason: narrowed }, USER_ADMIN_REFUSAL_COPY[narrowed])
    this.name = USER_ADMIN_REFUSED_ERROR_NAME
  }
}

const IMPERSONATION_STATE_ERROR_NAME = 'ImpersonationStateError'

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

const IMPERSONATION_STATE_COPY = {
  nested: 'Stop the current impersonation first.',
  replay_blocked: 'Stop impersonating before replaying deliveries.',
  not_impersonating: 'This session is not impersonating anyone.'
} satisfies Readonly<Record<ImpersonationStateReason, string>>

export class ImpersonationStateError extends UiError {
  constructor(reason: ImpersonationStateReason) {
    super('impersonation_state', { reason }, IMPERSONATION_STATE_COPY[reason])
    this.name = IMPERSONATION_STATE_ERROR_NAME
  }
}

const UNVERIFIED_EMAIL_ERROR_NAME = 'UnverifiedEmailError'

/** The workspace-creation gate's refusal for an unverified mailbox. */
export class UnverifiedEmailError extends UiError {
  constructor() {
    super(
      'unverified_email',
      {},
      'Verify your email address before creating a workspace.'
    )
    this.name = UNVERIFIED_EMAIL_ERROR_NAME
  }
}
