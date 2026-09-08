/* oxlint-disable anti-slop/no-runtime-typeof -- this is the client-safe decoder for untrusted serialized errors; Effect Schema cannot enter the browser bundle */
import { LocalizedError } from './localized-error'
import * as m from '@b2b-saas-starter/i18n/messages'

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
    case 'forbidden': {
      return reason === 'no_principal' ? m.shell_no_principal() : m.shell_forbidden()
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
      switch (reason) {
        case 'not_a_member': {
          return m.shell_not_member()
        }
        case 'sole_owner': {
          return m.shell_sole_owner()
        }
        case 'owner_requires_owner': {
          return m.shell_owner_required()
        }
        default: {
          return m.shell_membership_refused()
        }
      }
    }
    case 'user_admin_refused': {
      switch (reason) {
        case 'unknown_user': {
          return m.shell_unknown_user()
        }
        case 'not_a_member':
        case 'not_a_member_after_write': {
          return m.shell_not_member()
        }
        case 'cannot_impersonate_self': {
          return m.shell_impersonate_self()
        }
        case 'cannot_impersonate_admin': {
          return m.shell_impersonate_admin()
        }
        case 'not_impersonating': {
          return m.shell_not_impersonating()
        }
        default: {
          return m.shell_admin_refused()
        }
      }
    }
    default: {
      return fallback
    }
  }
}
