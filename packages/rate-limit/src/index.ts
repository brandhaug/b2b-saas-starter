import { failureMessage } from '@b2b-saas-starter/failure'
import { Clock, Effect, Result, type Scope } from 'effect'

// Cloudflare Rate Limiting binding shape (subset). The actual bindings are
// provisioned via alchemy.run.ts; declared here so consumers can type their env without
// depending on @cloudflare/workers-types directly.
export type CloudflareRateLimit = {
  readonly limit: (input: { readonly key: string }) => Promise<{
    readonly success: boolean
  }>
}

export type RateLimitInput<Bucket extends string> = {
  readonly bucket: Bucket
  readonly key: string
}

export type RateLimiterInterface<Bucket extends string> = {
  readonly take: (
    input: RateLimitInput<Bucket>
  ) => Effect.Effect<boolean, never, Scope.Scope>
}

export type RateLimiterConfig<Bucket extends string> = {
  /** Resolve the Cloudflare ratelimit binding for a bucket, if provisioned. */
  readonly binding: (bucket: Bucket) => CloudflareRateLimit | undefined
  /** Per-bucket allowance for the in-memory fallback's 60s window. */
  readonly fallbackLimits: Record<Bucket, number>
  /** Keys the fallback tracks per bucket; defaults to {@link FALLBACK_CAPACITY}. */
  readonly fallbackCapacity?: number | undefined
}

// In-memory fallback for local dev, tests, and transient binding failures.
//
// Caveat: this state is per-isolate (and lost on isolate recycle), so under
// real traffic each Workers isolate counts independently — the effective limit
// is `limit × isolates`. It is a best-effort brake, not an enforcement
// boundary; production limiting is the Cloudflare ratelimit bindings. The
// store lives at module scope so it survives across requests within an
// isolate (consumers rebuild the rate-limiter layer per request).
const FALLBACK_WINDOW_MS = 60_000

/**
 * Keys tracked per bucket. The fallback runs while the binding fails, often
 * under a flood of distinct IPs; a full bucket refuses keys it does not track
 * rather than growing or evicting a tracked caller's count, which would
 * reopen that caller's allowance.
 */
const FALLBACK_CAPACITY = 5000

type BucketState = { count: number; resetAt: number }

type FallbackDecision = 'allowed' | 'limited' | 'capacity_refused'

// Per bucket, in insertion order. Every window has the same length and an
// entry is re-inserted when its window restarts, so insertion order is
// expiry order: the sweep stops at the first live entry.
const fallbackStore = new Map<string, Map<string, BucketState>>()

export function makeRateLimiter<Bucket extends string>(
  config: RateLimiterConfig<Bucket>
): RateLimiterInterface<Bucket> {
  return {
    take: (input) =>
      Effect.gen(function* () {
        const binding = config.binding(input.bucket)
        if (binding) {
          const attempt = yield* Effect.result(
            Effect.tryPromise({
              try: () => binding.limit({ key: input.key }),
              // The failure never reaches a caller — `take` degrades to the
              // in-memory fallback — so the reason travels as the message it
              // will be logged as, not as a tagged class nothing catches.
              catch: failureMessage
            })
          )
          if (Result.isSuccess(attempt)) {
            return attempt.success.success
          }
          // Carry the binding's own failure reason onto the wide event before
          // degrading — the fallback must never hide why the binding failed.
          yield* Effect.annotateLogsScoped({
            rateLimitBindingError: attempt.failure
          })
        }
        // Falling back to the per-isolate in-memory map — either the binding
        // is missing (local dev, tests) or its call failed (transient
        // platform error). Don't fail open; flag the degraded mode on the
        // request's wide event so fallback traffic is queryable.
        yield* Effect.annotateLogsScoped({
          rateLimitDegraded: true,
          rateLimitFallback: fallbackReason(binding),
          rateLimitBucket: input.bucket
        })
        const now = yield* Clock.currentTimeMillis
        const decision = takeFromFallback(
          input.bucket,
          input.key,
          config.fallbackLimits[input.bucket],
          config.fallbackCapacity ?? FALLBACK_CAPACITY,
          now
        )
        if (decision === 'capacity_refused') {
          // A caller refused for room, not for its own rate, under a flood of
          // distinct keys: queryable apart from ordinary limiting.
          yield* Effect.annotateLogsScoped({ rateLimitCapacityRefused: true })
        }
        return decision === 'allowed'
      })
  }
}

export function clientKey(request: Request): string {
  // Only trust `cf-connecting-ip`: Cloudflare sets it on every request and
  // strips client-supplied values. `x-forwarded-for` is attacker-controlled
  // (rotate the header, dodge the limit), so it is deliberately not used.
  //
  // Authenticated routes would ideally key on the verified token id, but
  // rate limiting deliberately runs *before* token verification (which costs
  // a D1 read) so unauthenticated floods can't exhaust the database — the
  // token id is not known yet at keying time.
  const ip = request.headers.get('cf-connecting-ip')
  if (ip) {
    return ip
  }
  // Without the platform header (local dev, a non-Cloudflare front door)
  // there is nothing that identifies a caller, so this is deliberately NOT a
  // fair key: every caller of the path shares one bucket and one fate — the
  // first flood throttles everybody on that path until the window rolls. That
  // is the safe direction (no bypass) and it only happens where
  // `cf-connecting-ip` is missing, which in production is nowhere.
  return `unkeyed:${new URL(request.url).pathname}`
}

function takeFromFallback(
  bucket: string,
  key: string,
  limit: number,
  capacity: number,
  now: number
): FallbackDecision {
  let entries = fallbackStore.get(bucket)
  if (entries === undefined) {
    entries = new Map()
    fallbackStore.set(bucket, entries)
  }
  // Without expiry, a sustained binding failure retains every distinct IP
  // until the isolate dies. Expired entries sit at the front; no timer
  // survives independently of the request.
  for (const [id, state] of entries) {
    if (state.resetAt >= now) {
      break
    }
    entries.delete(id)
  }
  const existing = entries.get(key)
  // An expired entry behind a live one means the clock stepped back; restart
  // its window at the back so the order holds again.
  if (existing !== undefined && existing.resetAt < now) {
    entries.delete(key)
  } else if (existing !== undefined) {
    if (existing.count >= limit) {
      return 'limited'
    }
    existing.count += 1
    return 'allowed'
  }
  if (entries.size >= capacity) {
    return 'capacity_refused'
  }
  entries.set(key, { count: 1, resetAt: now + FALLBACK_WINDOW_MS })
  return 'allowed'
}

function fallbackReason(
  binding: CloudflareRateLimit | undefined
): 'binding_error' | 'missing_binding' {
  if (binding === undefined) {
    return 'missing_binding'
  }
  return 'binding_error'
}
