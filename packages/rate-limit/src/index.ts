import { Effect, type Scope } from 'effect'
import { annotateWide } from '@b2b-saas-starter/logger'

// Cloudflare Rate Limiting binding shape (subset). The actual bindings are
// provisioned via each worker's wrangler.jsonc (`unsafe.bindings`) and
// alchemy.run.ts; declared here so consumers can type their env without
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

export type RateLimiterShape<Bucket extends string> = {
  readonly take: (
    input: RateLimitInput<Bucket>
  ) => Effect.Effect<boolean, never, Scope.Scope>
}

export type RateLimiterConfig<Bucket extends string> = {
  /** Resolve the Cloudflare ratelimit binding for a bucket, if provisioned. */
  readonly binding: (bucket: Bucket) => CloudflareRateLimit | undefined
  /** Per-bucket allowance for the in-memory fallback's 60s window. */
  readonly fallbackLimits: Record<Bucket, number>
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

type BucketState = { count: number; resetAt: number }

const fallbackStore = new Map<string, BucketState>()

const takeFromFallback = (bucket: string, key: string, limit: number): boolean => {
  const id = `${bucket}:${key}`
  const now = Date.now()
  const existing = fallbackStore.get(id)
  if (!existing || existing.resetAt < now) {
    fallbackStore.set(id, { count: 1, resetAt: now + FALLBACK_WINDOW_MS })
    return true
  }
  if (existing.count >= limit) {
    return false
  }
  existing.count += 1
  return true
}

export const makeRateLimiter = <Bucket extends string>(
  config: RateLimiterConfig<Bucket>
): RateLimiterShape<Bucket> => ({
  take: (input) =>
    Effect.gen(function* () {
      const binding = config.binding(input.bucket)
      if (binding) {
        const outcome = yield* Effect.promise(async () => {
          try {
            return await binding.limit({ key: input.key })
          } catch {
            return null
          }
        })
        if (outcome) return outcome.success
      }
      // Falling back to the per-isolate in-memory map — either the binding
      // is missing (local dev, tests) or its call failed (transient
      // platform error). Don't fail open; flag the degraded mode on the
      // request's wide event so fallback traffic is queryable.
      yield* annotateWide({
        rateLimitDegraded: true,
        rateLimitFallback: binding ? 'binding_error' : 'missing_binding',
        rateLimitBucket: input.bucket
      })
      return takeFromFallback(
        input.bucket,
        input.key,
        config.fallbackLimits[input.bucket]
      )
    })
})

export const clientKey = (request: Request): string => {
  // Only trust `cf-connecting-ip`: Cloudflare sets it on every request and
  // strips client-supplied values. `x-forwarded-for` is attacker-controlled
  // (rotate the header, dodge the limit), so it is deliberately not used.
  //
  // Authenticated routes would ideally key on the verified token id, but
  // rate limiting deliberately runs *before* token verification (which costs
  // a D1 read) so unauthenticated floods can't exhaust the database — the
  // token id is not known yet at keying time.
  const ip = request.headers.get('cf-connecting-ip')
  if (ip) return ip
  // Without a client IP (local dev) we can't bucket fairly. Use the request
  // URL so a single misconfigured caller can't share the bucket with
  // everyone else.
  return `unkeyed:${new URL(request.url).pathname}`
}
