/* oxlint-disable anti-slop/no-runtime-typeof -- this is the client-safe decoder for untrusted serialized errors; Effect Schema cannot enter the browser bundle */
import { LocalizedError } from './localized-error'
import {
  type ForbiddenReason,
  type ImpersonationStateReason,
  type MembershipRefusalReason,
  type UserAdminRefusalReason
} from './capability-error'
import * as m from '@b2b-saas-starter/i18n/messages'

/**
 * One translated sentence per refusal reason, keyed by the reason vocabulary
 * `capability-error.ts` declares. The tables hold message *functions*, never
 * evaluated copy: a resolved sentence at module scope would pin the language
 * of whichever request loaded the module. Because the key type comes from the
 * error module, a reason added there without a sentence here is a type error.
 */
type ReasonMessages<Reason extends string> = Readonly<Record<Reason, () => string>>

/**
 * A reason table as the lookup below reads it: the constants above are object
 * literals, so their inferred types carry the implicit index signature this
 * parameter needs. Exhaustiveness still comes from each constant's own
 * `satisfies ReasonMessages<…>`.
 */
type ReasonLookup = Readonly<Record<string, (() => string) | undefined>>

const FORBIDDEN_MESSAGES = {
  no_principal: m.shell_no_principal,
  denied: m.shell_forbidden
} satisfies ReasonMessages<ForbiddenReason>

const MEMBERSHIP_MESSAGES = {
  not_a_member: m.shell_not_member,
  sole_owner: m.shell_sole_owner,
  owner_requires_owner: m.shell_owner_required,
  refused: m.shell_membership_refused
} satisfies ReasonMessages<MembershipRefusalReason>

const USER_ADMIN_MESSAGES = {
  unknown_user: m.shell_unknown_user,
  not_a_member: m.shell_not_member,
  not_a_member_after_write: m.shell_not_member,
  cannot_impersonate_self: m.shell_impersonate_self,
  cannot_impersonate_admin: m.shell_impersonate_admin,
  not_impersonating: m.shell_not_impersonating,
  refused: m.shell_admin_refused
} satisfies ReasonMessages<UserAdminRefusalReason>

const IMPERSONATION_STATE_MESSAGES = {
  nested: m.shell_impersonation_nested,
  replay_blocked: m.shell_impersonation_replay_blocked,
  not_impersonating: m.shell_not_impersonating
} satisfies ReasonMessages<ImpersonationStateReason>

/**
 * Translates a serialized reason, falling back to the discriminant's own
 * catch-all sentence when the value is not one this build knows.
 */
function reasonMessage<Reason extends string>(
  messages: ReasonMessages<Reason>,
  fallbackReason: Reason,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the reason arrives inside a serialized error's details; this lookup is its parse step
  reason: unknown
): string {
  // A key test against the constant record, not a rebuilt index:
  // `new Map(Object.entries(...))` allocated one map per translated sentence.
  // `Object.hasOwn` keeps inherited keys like `constructor` out of the lookup.
  const lookup: ReasonLookup = messages
  const message =
    (typeof reason === 'string' && Object.hasOwn(lookup, reason)
      ? lookup[reason]
      : undefined) ?? messages[fallbackReason]
  return message()
}

/** Decode known UI error data; never display an unexpected exception's message. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- rejected promise values are untrusted; this is their display boundary
export function causeMessage(thrown: unknown, fallback: string): string {
  // Local auth actions already translate allowlisted codes in this browser.
  // Serialized objects cannot acquire this local class identity.
  if (thrown instanceof LocalizedError) {
    return thrown.message
  }
  if (typeof thrown !== 'object' || thrown === null || !('code' in thrown)) {
    return fallback
  }
  const details =
    'details' in thrown && typeof thrown.details === 'object' && thrown.details !== null
      ? thrown.details
      : {}
  const reason = 'reason' in details ? details.reason : undefined
  switch (thrown.code) {
    case 'invalid_locale': {
      return m.shell_invalid_locale()
    }
    case 'invalid_timezone': {
      return m.shell_invalid_zone()
    }
    case 'unavailable': {
      return m.shell_unavailable_description()
    }
    case 'unauthorized': {
      return m.shell_unauthorized()
    }
    case 'strong_authentication_required': {
      return m.security_authentication_required()
    }
    case 'unverified_email': {
      return m.shell_unverified_email()
    }
    case 'forbidden': {
      return reasonMessage(FORBIDDEN_MESSAGES, 'denied', reason)
    }
    case 'workspace_suspended': {
      return m.workspace_suspended_member_notice()
    }
    case 'plan_limit': {
      if (
        'planId' in details &&
        typeof details.planId === 'string' &&
        'limit' in details &&
        typeof details.limit === 'number'
      ) {
        return m.shell_plan_limit({ planId: details.planId, limit: details.limit })
      }
      return fallback
    }
    case 'membership_refused': {
      return reasonMessage(MEMBERSHIP_MESSAGES, 'refused', reason)
    }
    case 'user_admin_refused': {
      return reasonMessage(USER_ADMIN_MESSAGES, 'refused', reason)
    }
    case 'impersonation_state': {
      return reasonMessage(IMPERSONATION_STATE_MESSAGES, 'not_impersonating', reason)
    }
    default: {
      return fallback
    }
  }
}
