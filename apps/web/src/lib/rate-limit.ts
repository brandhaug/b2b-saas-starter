import { Context, Layer } from 'effect'
import {
  clientKey,
  makeRateLimiter,
  type CloudflareRateLimit,
  type RateLimitInput as GenericRateLimitInput,
  type RateLimiterInterface as GenericRateLimiterInterface
} from '@b2b-saas-starter/rate-limit'

// Thin config module over @b2b-saas-starter/rate-limit: this file owns the
// web app's auth bucket union, fallback limits, and env-binding map; the
// mechanism (Cloudflare binding dispatch, module-scope in-memory fallback,
// degraded-mode telemetry, clientKey) lives in the shared package. The
// module-scope fallback store matters here: the auth route rebuilds the
// layer per request, so per-layer state would reset on every request and
// never limit anything.

export type RateLimitBindings = {
  readonly RATE_LIMITER_AUTH_READ?: CloudflareRateLimit
  readonly RATE_LIMITER_AUTH_WRITE?: CloudflareRateLimit
}

type AuthRateLimitBucket = 'auth_read' | 'auth_write'

export type RateLimitInput = GenericRateLimitInput<AuthRateLimitBucket>

export type RateLimiterInterface = GenericRateLimiterInterface<AuthRateLimitBucket>

export class RateLimiter extends Context.Service<RateLimiter, RateLimiterInterface>()(
  '@b2b-saas-starter/web/RateLimiter'
) {}

const FALLBACK_LIMITS: Record<AuthRateLimitBucket, number> = {
  auth_read: 60,
  auth_write: 20
}

function pickBinding(
  env: RateLimitBindings,
  bucket: AuthRateLimitBucket
): CloudflareRateLimit | undefined {
  return bucket === 'auth_read'
    ? env.RATE_LIMITER_AUTH_READ
    : env.RATE_LIMITER_AUTH_WRITE
}

export function makeRateLimiterLayer(env: RateLimitBindings): Layer.Layer<RateLimiter> {
  return Layer.succeed(RateLimiter)(
    makeRateLimiter({
      binding: (bucket) => pickBinding(env, bucket),
      fallbackLimits: FALLBACK_LIMITS
    })
  )
}

export { clientKey }
