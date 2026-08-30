import { Schema } from 'effect'
import { currentRequest } from '../request-context'

/**
 * Shared helper for the server-only `*-binding.ts` adapters (invitation,
 * member, user-admin, workspace lifecycle), which all need the same
 * "take session headers from the in-flight request or refuse" behavior.
 */

/**
 * A plugin call attempted with no in-flight request to take session headers
 * from. It carries an explicit `message` and, deliberately, no `statusCode`:
 * `classifyBindingFailure` reads the status to tell "the workspace refuses"
 * from "the store is unreachable", and nothing about the binding is wrong
 * here — so it must land on the unavailable side (the store is not refusing —
 * there was no store to ask).
 */
// oxlint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is a curried factory call, not an un-new-ed error constructor
export class MissingRequestHeaders extends Schema.TaggedError<MissingRequestHeaders>()(
  'MissingRequestHeaders',
  { message: Schema.String }
) {}

/**
 * The headers of the in-flight request, or a thrown `MissingRequestHeaders`.
 * Throwing raw is deliberate: it rejects the promise the binding port
 * returns, which has no Effect error channel on this side of it.
 */
export function requireHeaders(headers: Headers | undefined): Headers {
  if (!headers) {
    // oxlint-disable-next-line effect/noThrowStatement -- rejects the promise the binding port returns; there is no Effect error channel on this side of it
    throw new MissingRequestHeaders({ message: 'no_request_headers' })
  }
  return headers
}

/** Convenience for the near-universal `requireHeaders(currentRequest()?.headers)`. */
export function requestHeaders(): Headers {
  return requireHeaders(currentRequest()?.headers)
}
