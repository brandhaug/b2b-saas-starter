import { Context, Effect, Result, Schedule, Schema } from 'effect'
import { SecureRandom } from 'effect/crypto'
import { CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'
import { annotateWideEvent } from '@b2b-saas-starter/logger'
/**
 * Cloudflare Turnstile server-side verification (ADR 0031). The widget proves
 * a human filled the form; this capability asks Cloudflare's `siteverify`
 * endpoint whether the token the widget produced is real. It holds no store —
 * unlike most capabilities there is no Seed/Live split, only one adapter whose
 * HTTP call is injectable for tests.
 *
 * Provider-light by construction: built without a secret key it reports
 * `enabled: false` and every verification comes back `inactive`, so callers
 * gate on the outcome instead of branching on configuration themselves.
 */

const SiteverifyResponse = Schema.Struct({
  success: Schema.optionalKey(Schema.Boolean),
  'error-codes': Schema.optionalKey(Schema.Array(Schema.String))
})
type SiteverifyResponse = typeof SiteverifyResponse.Type

/**
 * The request body siteverify expects. Tokens are single-use, so a repeat
 * without `idempotency_key` reads as `timeout-or-duplicate`; one key per
 * `verify` call, reused across its attempts, makes the retry safe.
 */
export type SiteverifyRequest = {
  readonly secret: string
  readonly response: string
  readonly remoteip?: string | undefined
  readonly idempotency_key: string
}

/**
 * No response arrived (fetch rejected). The only retryable failure: the
 * request may still have reached Cloudflare, which the idempotency key covers.
 */
// oxlint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is a curried factory call, not an un-new-ed error constructor
export class SiteverifyNoResponse extends Schema.TaggedError<SiteverifyNoResponse>()(
  'SiteverifyNoResponse',
  {}
) {}

/**
 * The JSON POST to siteverify, as a port so tests can stand in for the
 * network. Resolves with the provider's response, whatever its status, and
 * fails only when no response arrived. Status, body and deadline policy stay
 * in the verifier.
 */
export type SiteverifyTransport = (
  request: SiteverifyRequest
) => Effect.Effect<Response, SiteverifyNoResponse>

type TurnstileVerificationInput = {
  /** The `cf-turnstile-response` token the widget produced. */
  readonly token: string
  /** The visitor's IP, when the caller has it — siteverify scores better with it. */
  readonly remoteIp?: string | undefined
}

type TurnstileOutcome =
  | { readonly outcome: 'inactive' }
  | { readonly outcome: 'verified' }
  | { readonly outcome: 'unavailable' }
  | {
      readonly outcome: 'rejected'
      /** Cloudflare's own error codes (`invalid-input-response`, …), for logs. */
      readonly codes: ReadonlyArray<string>
    }

type TurnstileVerifierInterface = {
  /**
   * Whether server-side verification is configured at all. Callers that only
   * need the gate read this; `verify` returns `inactive` when it is false.
   */
  readonly enabled: boolean
  /** Never fails: siteverify trouble surfaces as `outcome: 'unavailable'` so callers fail closed without an error channel. */
  readonly verify: (
    input: TurnstileVerificationInput
  ) => Effect.Effect<TurnstileOutcome>
}

export class TurnstileVerifier extends Context.Service<
  TurnstileVerifier,
  TurnstileVerifierInterface
>()('@b2b-saas-starter/capabilities/TurnstileVerifier') {}

// One compiled boundary decode: rebuilt once at module load, not per request.
const decodeSiteverifyResponse = Schema.decodeUnknownResult(SiteverifyResponse)

/**
 * The Workers global `fetch`, mirroring the Stripe capability's
 * platform-adapter stance: an HTTP client dependency would add weight, not
 * safety, to one JSON POST. `Effect.tryPromise` passes its `AbortSignal`, so
 * interruption and the verifier's deadline reach the socket.
 */
function fetchSiteverify(
  request: SiteverifyRequest
): Effect.Effect<Response, SiteverifyNoResponse> {
  return Effect.tryPromise({
    try: (signal) =>
      // oxlint-disable-next-line effect/noGlobals -- the Workers global fetch is the platform adapter here; JSON body encoding included; see the Stripe twin in billing.ts
      fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // oxlint-disable-next-line effect/noGlobals -- one JSON POST to a fixed endpoint; a Schema codec adds nothing here
        body: JSON.stringify(request),
        signal
      }),
    catch: () => new SiteverifyNoResponse()
  })
}

/**
 * Why siteverify gave no verdict, as the code-owned label the wide event
 * carries (`turnstileUnavailable`, allowlisted in the logger's sanitization).
 */
type SiteverifyFailureReason =
  | 'no_response'
  | 'timeout'
  | 'status_3xx'
  | 'status_4xx'
  | 'status_5xx'
  | 'unparseable_body'
  | 'no_verdict'

function unavailableBecause(reason: SiteverifyFailureReason) {
  return new CapabilityUnavailable({ capability: 'turnstile-verification', reason })
}

function statusClass(status: number): SiteverifyFailureReason {
  if (status >= 500) {
    return 'status_5xx'
  }
  if (status >= 400) {
    return 'status_4xx'
  }
  return 'status_3xx'
}

/**
 * One attempt. A timeout is not retryable: three 10 s waits would outlast the
 * form. The status is checked before the body, so an error response carrying
 * `success: false` cannot read as a bot verdict.
 */
const siteverifyOnce = Effect.fn('TurnstileVerifier.siteverify')(function* (
  transport: SiteverifyTransport,
  request: SiteverifyRequest
) {
  const response = yield* transport(request).pipe(
    Effect.timeoutOrElse({
      duration: '10 seconds',
      orElse: () => Effect.fail(unavailableBecause('timeout'))
    })
  )
  if (!response.ok) {
    // The body is never read; cancelling it releases the connection.
    const body = response.body
    if (body !== null) {
      // An errored stream rejects cancel(); the verifier still answers unavailable.
      yield* Effect.tryPromise(() => body.cancel()).pipe(Effect.ignore)
    }
    return yield* unavailableBecause(statusClass(response.status))
  }
  const json: unknown = yield* Effect.tryPromise({
    try: () => response.json(),
    catch: () => unavailableBecause('unparseable_body')
  })
  const decoded = decodeSiteverifyResponse(json)
  if (Result.isFailure(decoded)) {
    return yield* unavailableBecause('unparseable_body')
  }
  if (decoded.success.success === undefined) {
    return yield* unavailableBecause('no_verdict')
  }
  return decoded.success
})

function failureReason(failure: CapabilityUnavailable | SiteverifyNoResponse): string {
  if (failure._tag === 'SiteverifyNoResponse') {
    return 'no_response'
  }
  return failure.reason
}

const newIdempotencyKey = SecureRandom.SecureRandom.use((random) =>
  random.uuidV4()
).pipe(Effect.provide(SecureRandom.layerWebCrypto))

function classify(response: SiteverifyResponse): TurnstileOutcome {
  if (response.success === true) {
    return { outcome: 'verified' }
  }
  return { outcome: 'rejected', codes: response['error-codes'] ?? [] }
}

function buildRequest(
  secretKey: string,
  token: string,
  remoteIp: string | undefined,
  idempotencyKey: string
): SiteverifyRequest {
  const request = {
    secret: secretKey,
    response: token,
    idempotency_key: idempotencyKey
  }
  if (remoteIp === undefined || remoteIp.length === 0) {
    return request
  }
  return { ...request, remoteip: remoteIp }
}

export function makeTurnstileVerifier(options: {
  readonly secretKey?: string | undefined
  readonly transport?: SiteverifyTransport | undefined
}): TurnstileVerifierInterface {
  const secretKey = options.secretKey
  const enabled = secretKey !== undefined && secretKey.length > 0
  const transport = options.transport ?? fetchSiteverify
  const unavailable: TurnstileOutcome = { outcome: 'unavailable' }

  return {
    enabled,
    verify: ({ remoteIp, token }) =>
      Effect.gen(function* () {
        if (!enabled) {
          const inactive: TurnstileOutcome = { outcome: 'inactive' }
          return inactive
        }
        if (token.length === 0) {
          const missing: TurnstileOutcome = {
            outcome: 'rejected',
            codes: ['missing-input-response']
          }
          return missing
        }
        // Siteverify trouble is infrastructure, not a bot verdict — fold the
        // typed failure into an `unavailable` outcome so `verify` never fails.
        // Only a request that got no response is retried, under the same
        // idempotency key; checkout creation (Stripe) is not idempotent and
        // gets none.
        const request = buildRequest(
          secretKey,
          token,
          remoteIp,
          yield* newIdempotencyKey
        )
        const attempted = yield* Effect.result(
          siteverifyOnce(transport, request).pipe(
            Effect.retry({
              while: (error) => error._tag === 'SiteverifyNoResponse',
              schedule: Schedule.jittered(Schedule.exponential('100 millis')),
              times: 2
            })
          )
        )
        if (Result.isFailure(attempted)) {
          yield* annotateWideEvent({
            turnstileUnavailable: failureReason(attempted.failure)
          })
          return unavailable
        }
        return classify(attempted.success)
      })
  }
}
