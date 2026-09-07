import { createSerializationAdapter } from '@tanstack/react-router'

/** Only allowlisted data crosses the browser boundary; internal errors use a fallback. */
export type UiErrorCode =
  | 'unavailable'
  | 'forbidden'
  | 'plan_limit'
  | 'membership_refused'
  | 'user_admin_refused'
  | 'unauthorized'
  | 'invalid_timezone'
  | 'invalid_locale'
  | 'sso_required'

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

export const uiErrorAdapter = createSerializationAdapter({
  key: 'starter-ui-error',
  // The adapter tests local values before encoding, never a remote class identity.
  test: (value): value is UiError => value instanceof UiError,
  toSerializable: (value) => ({
    code: value.code,
    details: value.details,
    name: value.name
  }),
  fromSerializable: (value) => {
    const error = new UiError(value.code, value.details, value.code)
    error.name = value.name
    return error
  }
})
