import { causeMessage } from './cause-message'
import { m } from '@b2b-saas-starter/i18n/messages'

/**
 * How the two typed account-deletion refusals read on the client. A
 * server-function rejection crosses the boundary through
 * `defaultSerializeError`, which keeps only `name`/`message`, so the panel
 * matches on `name` — the same rule `CAPABILITY_UNAVAILABLE_ERROR_NAME`
 * follows in `capability-error.ts`.
 */
export const ACCOUNT_DELETION_REJECTED_NAME = 'AccountDeletionRejected'
export const ACCOUNT_DELETION_BLOCKED_NAME = 'AccountDeletionBlocked'

function deleteFailed(): string {
  return m.public_auth_delete_failed()
}

function passwordRefusedMessage(): string {
  return m.public_auth_delete_password_rejected()
}

function blockedMessage(): string {
  return m.public_auth_delete_blocked()
}

// oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof -- `unknown` is the input: a rejected promise's value has no boundary schema, and probing it realm-safe needs one typeof
export function describeDeleteFailure(thrown: unknown): string {
  if (typeof thrown === 'object' && thrown !== null && 'name' in thrown) {
    if (thrown.name === ACCOUNT_DELETION_REJECTED_NAME) {
      return passwordRefusedMessage()
    }
    if (thrown.name === ACCOUNT_DELETION_BLOCKED_NAME) {
      return blockedMessage()
    }
  }
  return causeMessage(thrown, deleteFailed())
}
// oxlint-enable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof
