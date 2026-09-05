import { Schema } from 'effect'
import {
  LOCAL_D1_UNAVAILABLE_ERROR_CODE,
  LOCAL_D1_UNAVAILABLE_MESSAGE
} from '../auth-error-copy'

/**
 * The local-D1-absent vocabulary, server half. `lib/auth-error-copy.ts`
 * owns the wire code and the sentence (the client half — the sign-in card
 * maps the code to the same sentence); this module owns what the server
 * answers with them: the 503 response, and the sentinel defect everything
 * else in the degraded state throws.
 *
 * Server-only by consumer, not by import: nothing here touches
 * `cloudflare:workers`, but only `lib/auth-runtime.ts` and the well-known
 * OAuth routes should import it.
 */

/**
 * Defect raised when something reaches for an Auth surface the degraded
 * service does not provide (the catchall's session pre-read catching it as
 * "no session" is the one production reader). Tagged so the wide-event
 * logger reports `errorTag` instead of an opaque message.
 */
// oxlint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is a curried factory call, not an un-new-ed error constructor
export class MissingD1Binding extends Schema.TaggedError<MissingD1Binding>()(
  'MissingD1Binding',
  { property: Schema.String }
) {}

/**
 * Whether a thrown value is the sentinel, matched by tag — the repo's
 * name-discriminant discipline (see `lib/capability-error.ts`): never
 * `instanceof` across module boundaries, never message text.
 */
// oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof -- a rejected promise's value is `unknown` by construction; this probe is the parse step
export function isMissingD1Binding(thrown: unknown): boolean {
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
  return new Response(
    JSON.stringify({
      code: LOCAL_D1_UNAVAILABLE_ERROR_CODE,
      message: LOCAL_D1_UNAVAILABLE_MESSAGE
    }),
    { status: 503, headers: { 'content-type': 'application/json; charset=utf-8' } }
  )
}

/**
 * Runs a request handler, converting an escaped `MissingD1Binding` defect
 * into the guidance 503 rather than a stack-traced 500. Defense in depth for
 * the well-known OAuth routes: the degraded auth service answers the 503
 * from inside the handler, but anything that still throws the sentinel past
 * that must not become the crash loop a fresh clone sees today.
 */
// oxlint-disable anti-slop/no-unknown-parameters, effect/noNewPromise -- a rejected promise's value is `unknown` by construction and `isMissingD1Binding` is the parse step; the promise fold is the route-handler boundary `callServerFn` also works at, which is why this guard lives outside Effect
export function answeringLocalD1(run: () => Promise<Response>): Promise<Response> {
  return run().catch((error: unknown) =>
    isMissingD1Binding(error) ? localD1UnavailableResponse() : Promise.reject(error)
  )
}
// oxlint-enable anti-slop/no-unknown-parameters, effect/noNewPromise
