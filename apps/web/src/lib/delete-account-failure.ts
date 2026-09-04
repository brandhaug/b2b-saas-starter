import { causeMessage } from './cause-message'

/**
 * How the two typed account-deletion refusals read on the client. A
 * server-function rejection crosses the boundary through
 * `defaultSerializeError`, which keeps only `name`/`message`, so the panel
 * matches on `name` — the same rule `CAPABILITY_UNAVAILABLE_ERROR_NAME`
 * follows in `capability-error.ts`.
 */
export const ACCOUNT_DELETION_REJECTED_NAME = 'AccountDeletionRejected'
export const ACCOUNT_DELETION_BLOCKED_NAME = 'AccountDeletionBlocked'

const DELETE_FAILED = 'Could not delete the account'
const PASSWORD_REFUSED_MESSAGE = 'That password is not correct.'
const BLOCKED_MESSAGE =
  'Transfer ownership of your workspaces before deleting your account.'

// oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof -- `unknown` is the input: a rejected promise's value has no boundary schema, and probing it realm-safe needs one typeof
export function describeDeleteFailure(thrown: unknown): string {
  if (typeof thrown === 'object' && thrown !== null && 'name' in thrown) {
    if (thrown.name === ACCOUNT_DELETION_REJECTED_NAME) {
      return PASSWORD_REFUSED_MESSAGE
    }
    if (thrown.name === ACCOUNT_DELETION_BLOCKED_NAME) {
      return BLOCKED_MESSAGE
    }
  }
  return causeMessage(thrown, DELETE_FAILED)
}
// oxlint-enable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof
