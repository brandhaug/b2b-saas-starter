import { Context, Effect, Layer, Result, Schedule, Schema } from 'effect'
import { CapabilityUnavailable } from '../errors.ts'
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

export const SiteverifyResponse = Schema.Struct({
  success: Schema.optionalKey(Schema.Boolean),
  'error-codes': Schema.optionalKey(Schema.Array(Schema.String))
})
export type SiteverifyResponse = typeof SiteverifyResponse.Type

/** The request body siteverify expects — secret plus the widget's token. */
export type SiteverifyRequest = {
  readonly secret: string
  readonly response: string
  readonly remoteip?: string | undefined
}

/**
 * The JSON POST to siteverify, as a port so tests can stand in for the
 * network. Fails with {@link CapabilityUnavailable} on transport failure or a
 * response that does not match the documented shape — both are "siteverify is
 * unreachable/misbehaving", never a bot verdict.
 */
export type SiteverifyCaller = (
  request: SiteverifyRequest
) => Effect.Effect<SiteverifyResponse, CapabilityUnavailable>

export type TurnstileVerificationInput = {
  /** The `cf-turnstile-response` token the widget produced. */
  readonly token: string
  /** The visitor's IP, when the caller has it — siteverify scores better with it. */
  readonly remoteIp?: string | undefined
}

export type TurnstileOutcome =
  | { readonly outcome: 'inactive' }
  | { readonly outcome: 'verified' }
  | { readonly outcome: 'unavailable' }
  | {
      readonly outcome: 'rejected'
      /** Cloudflare's own error codes (`invalid-input-response`, …), for logs. */
      readonly codes: ReadonlyArray<string>
    }

export type TurnstileVerifierInterface = {
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
 * One JSON POST to siteverify, via the Workers global `fetch` — mirroring the
 * Stripe capability's platform-adapter stance: an HTTP client dependency would
 * add weight, not safety, to one JSON POST. The call carries an `AbortSignal`
 * from `Effect.tryPromise` so interruption and the 10s deadline reach the
 * socket, and transport failures surface as typed `CapabilityUnavailable`
 * instead of defects. Exported for tests.
 */
export const liveSiteverifyCaller: SiteverifyCaller = Effect.fnUntraced(function* (
  request: SiteverifyRequest
) {
  const response = yield* Effect.tryPromise({
    try: (signal) =>
      // oxlint-disable-next-line effect/noGlobals -- the Workers global fetch is the platform adapter here; JSON body encoding included; see the Stripe twin in billing.ts
      fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // oxlint-disable-next-line effect/noGlobals -- one JSON POST to a fixed endpoint; a Schema codec adds nothing here
        body: JSON.stringify(request),
        signal
      }),
    catch: () =>
      new CapabilityUnavailable({
        capability: 'turnstile-verification',
        reason: 'siteverify request failed'
      })
  }).pipe(
    Effect.timeout('10 seconds'),
    // Same "siteverify unreachable" failure the transport path reports.
    Effect.catchTag('TimeoutError', () =>
      Effect.fail(
        new CapabilityUnavailable({
          capability: 'turnstile-verification',
          reason: 'siteverify request timed out'
        })
      )
    )
  )
  const json: unknown = yield* Effect.tryPromise({
    try: () => response.json(),
    catch: () =>
      new CapabilityUnavailable({
        capability: 'turnstile-verification',
        reason: `siteverify responded ${response.status} with an unparseable body`
      })
  })
  const decoded = decodeSiteverifyResponse(json)
  if (Result.isFailure(decoded)) {
    return yield* new CapabilityUnavailable({
      capability: 'turnstile-verification',
      reason: `siteverify responded ${response.status} with an unparseable body`
    })
  }
  if (decoded.success.success === undefined) {
    return yield* new CapabilityUnavailable({
      capability: 'turnstile-verification',
      reason: `siteverify responded ${response.status} without a verdict`
    })
  }
  return decoded.success
})

function classify(response: SiteverifyResponse): TurnstileOutcome {
  if (response.success === true) {
    return { outcome: 'verified' }
  }
  return { outcome: 'rejected', codes: response['error-codes'] ?? [] }
}

function buildRequest(
  secretKey: string,
  token: string,
  remoteIp: string | undefined
): SiteverifyRequest {
  if (remoteIp === undefined || remoteIp.length === 0) {
    return { secret: secretKey, response: token }
  }
  return { secret: secretKey, response: token, remoteip: remoteIp }
}

export function makeTurnstileVerifier(options: {
  readonly secretKey?: string | undefined
  readonly siteverify?: SiteverifyCaller | undefined
}): TurnstileVerifierInterface {
  const secretKey = options.secretKey
  const enabled = secretKey !== undefined && secretKey.length > 0
  const siteverify = options.siteverify ?? liveSiteverifyCaller
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
        // Verification is idempotent, so a bounded jittered retry rides in
        // front of the fold; checkout creation (Stripe) is not idempotent and
        // gets none.
        const attempted = yield* Effect.result(
          siteverify(buildRequest(secretKey, token, remoteIp)).pipe(
            Effect.retry(
              Schedule.upTo({ times: 2 })(
                Schedule.jittered(Schedule.exponential('100 millis'))
              )
            )
          )
        )
        if (Result.isFailure(attempted)) {
          return unavailable
        }
        return classify(attempted.success)
      })
  }
}

/** Layer built from worker env — the web app calls this per deployment config. */
export function makeTurnstileVerifierLayer(options: {
  readonly secretKey?: string | undefined
}): Layer.Layer<TurnstileVerifier> {
  return Layer.succeed(TurnstileVerifier)(makeTurnstileVerifier(options))
}
