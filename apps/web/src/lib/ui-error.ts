import { Schema } from 'effect'

/** Only allowlisted data crosses the browser boundary; internal errors use a fallback. */
export type UiErrorCode =
  | 'unavailable'
  | 'forbidden'
  | 'workspace_suspended'
  | 'workspace_billing_obligations'
  | 'plan_limit'
  | 'membership_refused'
  | 'user_admin_refused'
  | 'impersonation_state'
  | 'unverified_email'
  | 'unauthorized'
  | 'strong_authentication_required'
  | 'invalid_timezone'
  | 'invalid_locale'
  | 'not_found'

export class UiError extends Error {
  readonly code: UiErrorCode
  readonly details: Readonly<Record<string, string | number>>

  constructor(
    code: UiErrorCode,
    details: Readonly<Record<string, string | number>>,
    message: string
  ) {
    super(message)
    this.code = code
    this.details = details
    this.name = 'UiError'
  }
}

export const UiErrorCodeSchema = Schema.Literals([
  'unavailable',
  'forbidden',
  'workspace_suspended',
  'workspace_billing_obligations',
  'plan_limit',
  'membership_refused',
  'user_admin_refused',
  'impersonation_state',
  'unverified_email',
  'unauthorized',
  'strong_authentication_required',
  'invalid_timezone',
  'invalid_locale',
  'not_found'
])

export const UiErrorPayload = Schema.Struct({
  code: UiErrorCodeSchema,
  details: Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Number])),
  name: Schema.String
})

export const uiErrorAdapter = {
  key: 'starter-ui-error',
  // The adapter tests local values before encoding, never a remote class identity.
  test: (value: unknown): value is UiError => value instanceof UiError,
  toSerializable: (value: UiError) => ({
    code: value.code,
    details: value.details,
    name: value.name
  }),
  fromSerializable: (value: typeof UiErrorPayload.Type) => {
    const error = new UiError(value.code, value.details, value.code)
    error.name = value.name
    return error
  }
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- TanStack error boundaries accept arbitrary thrown values; this predicate validates the UI error class.
export function isStrongAuthenticationError(error: unknown): boolean {
  return error instanceof UiError && error.code === 'strong_authentication_required'
}
