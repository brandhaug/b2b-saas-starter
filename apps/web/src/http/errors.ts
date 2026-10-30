import { Effect, Schema } from 'effect'
import { UiError, UiErrorCodeSchema } from '../lib/ui-error'

const fields = {
  code: UiErrorCodeSchema,
  details: Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Number]))
}

// oxlint-disable-next-line unicorn/throw-new-error -- TaggedError is a curried schema factory
export class WebFailure extends Schema.TaggedError<WebFailure>()('WebFailure', fields, {
  httpApiStatus: 400
}) {}
// oxlint-disable-next-line unicorn/throw-new-error -- TaggedError is a curried schema factory
export class WebUnauthorized extends Schema.TaggedError<WebUnauthorized>()(
  'WebUnauthorized',
  fields,
  { httpApiStatus: 401 }
) {}
// oxlint-disable-next-line unicorn/throw-new-error -- TaggedError is a curried schema factory
export class WebForbidden extends Schema.TaggedError<WebForbidden>()(
  'WebForbidden',
  fields,
  { httpApiStatus: 403 }
) {}
// oxlint-disable-next-line unicorn/throw-new-error -- TaggedError is a curried schema factory
export class WebNotFound extends Schema.TaggedError<WebNotFound>()(
  'WebNotFound',
  fields,
  { httpApiStatus: 404 }
) {}
// oxlint-disable-next-line unicorn/throw-new-error -- TaggedError is a curried schema factory
export class WebUnavailable extends Schema.TaggedError<WebUnavailable>()(
  'WebUnavailable',
  fields,
  { httpApiStatus: 503 }
) {}
export const WebErrors = [
  WebFailure,
  WebUnauthorized,
  WebForbidden,
  WebNotFound,
  WebUnavailable
] as const
export const WebErrorSchema = Schema.Union(WebErrors)

function publicDetails(error: UiError): UiError['details'] {
  const details: Record<string, string | number> = {}
  if (error.code === 'plan_limit') {
    if (error.details.planId !== undefined) {
      details.planId = error.details.planId
    }
    if (error.details.limit !== undefined) {
      details.limit = error.details.limit
    }
  }
  if (
    [
      'forbidden',
      'membership_refused',
      'user_admin_refused',
      'impersonation_state'
    ].includes(error.code) &&
    error.details.reason !== undefined
  ) {
    details.reason = error.details.reason
  }
  return details
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- thrown Promise failures are untrusted; only UiError values cross this transport classifier
export function publicFailure(error: unknown): typeof WebErrorSchema.Type {
  const code = error instanceof UiError ? error.code : 'unavailable'
  const details = error instanceof UiError ? publicDetails(error) : {}
  const value = { code, details }
  switch (code) {
    case 'unauthorized': {
      return new WebUnauthorized(value)
    }
    case 'forbidden':
    case 'workspace_suspended':
    case 'strong_authentication_required': {
      return new WebForbidden(value)
    }
    case 'not_found': {
      return new WebNotFound(value)
    }
    case 'unavailable': {
      return new WebUnavailable(value)
    }
    case 'impersonation_state':
    case 'invalid_locale':
    case 'invalid_timezone':
    case 'membership_refused':
    case 'plan_limit':
    case 'unverified_email':
    case 'user_admin_refused':
    case 'workspace_billing_obligations': {
      return new WebFailure(value)
    }
  }
}

/** Expose only the public vocabulary; capability runners retain diagnostic evidence. */
export function invoke<A>(
  run: () => Promise<A> | A
): Effect.Effect<A, typeof WebErrorSchema.Type> {
  return Effect.tryPromise({ try: async () => run(), catch: publicFailure })
}
