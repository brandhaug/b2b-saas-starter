import { Schema } from 'effect'
import {
  LOCAL_D1_UNAVAILABLE_ERROR_CODE,
  localD1UnavailableMessage
} from '../auth-error-copy'
import { authRefusal } from './auth-refusal'

/** Explicit failure for plugin operations when local persistence is absent. */
// oxlint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is a curried factory call, not an un-new-ed error constructor
export class MissingD1Binding extends Schema.TaggedError<MissingD1Binding>()(
  'MissingD1Binding',
  { property: Schema.String }
) {}

/**
 * Whether a thrown value is the missing-binding error, matched by tag — the repo's
 * name-discriminant discipline (see `lib/capability-error.ts`): never
 * `instanceof` across module boundaries, never message text.
 */
// oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof -- a rejected promise's value is `unknown` by construction; this probe is the parse step
function isMissingD1Binding(thrown: unknown): boolean {
  return (
    typeof thrown === 'object' &&
    thrown !== null &&
    '_tag' in thrown &&
    thrown._tag === 'MissingD1Binding'
  )
}
// oxlint-enable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof

/**
 * The one-line 503 every auth request answers when no local D1 binding
 * exists: the code the client maps, the sentence that names the fix, the
 * same `{ code, message }` body shape the auth catchall's own gates use.
 */
export function localD1UnavailableResponse(): Response {
  return authRefusal(503, LOCAL_D1_UNAVAILABLE_ERROR_CODE, {
    message: localD1UnavailableMessage()
  })
}

/**
 * Runs a request handler, converting an escaped `MissingD1Binding` defect
 * into the guidance 503 rather than a stack-traced 500. Defense in depth for
 * the well-known OAuth routes. The HTTP boundary answers 503 directly;
 * escaped plugin failures receive the same guidance.
 */
// oxlint-disable anti-slop/no-unknown-parameters, effect/noNewPromise -- a rejected promise's value is `unknown` by construction and `isMissingD1Binding` is the parse step; the promise fold is the route-handler boundary `callServerFn` also works at, which is why this guard lives outside Effect
export function answeringLocalD1(run: () => Promise<Response>): Promise<Response> {
  return run().catch((error: unknown) =>
    isMissingD1Binding(error) ? localD1UnavailableResponse() : Promise.reject(error)
  )
}
// oxlint-enable anti-slop/no-unknown-parameters, effect/noNewPromise
