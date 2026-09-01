import { makeRateLimiter, type CloudflareRateLimit } from '@b2b-saas-starter/rate-limit'
import { RateLimiter, type RateLimitBucket } from '@b2b-saas-starter/api'
import { Layer } from 'effect'

// Thin config module over @b2b-saas-starter/rate-limit: this file owns the
// api worker's fallback limits and env-binding map; the mechanism (Cloudflare
// binding dispatch, module-scope in-memory fallback, degraded-mode telemetry,
// clientKey) lives in the shared package, and the bucket union plus the
// `RateLimiter` service live on the contract beside the `BearerAuth`
// middleware that draws from them.

export type RateLimitBindings = {
  readonly RATE_LIMITER_REST?: CloudflareRateLimit
  readonly RATE_LIMITER_REST_WRITE?: CloudflareRateLimit
  readonly RATE_LIMITER_ASSISTANT?: CloudflareRateLimit
  readonly RATE_LIMITER_MCP?: CloudflareRateLimit
}

export { RateLimiter, type RateLimitBucket }

const FALLBACK_LIMITS = {
  rest_read: 60,
  rest_write: 20,
  assistant: 20,
  mcp: 30
} satisfies Record<RateLimitBucket, number>

function pickBinding(
  env: RateLimitBindings,
  bucket: RateLimitBucket
): CloudflareRateLimit | undefined {
  switch (bucket) {
    case 'rest_read': {
      return env.RATE_LIMITER_REST
    }
    case 'rest_write': {
      return env.RATE_LIMITER_REST_WRITE
    }
    case 'assistant': {
      return env.RATE_LIMITER_ASSISTANT
    }
    case 'mcp': {
      return env.RATE_LIMITER_MCP
    }
  }
}

export function makeRateLimiterLayer(env: RateLimitBindings): Layer.Layer<RateLimiter> {
  return Layer.succeed(RateLimiter)(
    makeRateLimiter({
      binding: (bucket) => pickBinding(env, bucket),
      fallbackLimits: FALLBACK_LIMITS
    })
  )
}
