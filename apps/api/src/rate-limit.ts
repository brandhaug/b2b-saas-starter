import { Context, Layer } from 'effect'
import {
  clientKey,
  makeRateLimiter,
  type CloudflareRateLimit,
  type RateLimitInput as GenericRateLimitInput,
  type RateLimiterShape as GenericRateLimiterShape
} from '@b2b-saas-starter/rate-limit'

// Thin config module over @b2b-saas-starter/rate-limit: this file owns the
// api worker's bucket union, fallback limits, and env-binding map; the
// mechanism (Cloudflare binding dispatch, module-scope in-memory fallback,
// degraded-mode telemetry, clientKey) lives in the shared package.

export type RateLimitBindings = {
  readonly RATE_LIMITER_REST?: CloudflareRateLimit
  readonly RATE_LIMITER_REST_WRITE?: CloudflareRateLimit
  readonly RATE_LIMITER_INVITATIONS?: CloudflareRateLimit
  readonly RATE_LIMITER_ASSISTANT?: CloudflareRateLimit
  readonly RATE_LIMITER_MCP?: CloudflareRateLimit
}

export type RateLimitBucket =
  | 'rest_read'
  | 'rest_write'
  | 'invitations'
  | 'assistant'
  | 'mcp'

export type RateLimitInput = GenericRateLimitInput<RateLimitBucket>

export type RateLimiterShape = GenericRateLimiterShape<RateLimitBucket>

export class RateLimiter extends Context.Service<RateLimiter, RateLimiterShape>()(
  '@b2b-saas-starter/api/RateLimiter'
) {}

const FALLBACK_LIMITS: Record<RateLimitBucket, number> = {
  rest_read: 60,
  rest_write: 20,
  invitations: 10,
  assistant: 20,
  mcp: 30
}

const pickBinding = (
  env: RateLimitBindings,
  bucket: RateLimitBucket
): CloudflareRateLimit | undefined => {
  switch (bucket) {
    case 'rest_read':
      return env.RATE_LIMITER_REST
    case 'rest_write':
      return env.RATE_LIMITER_REST_WRITE
    case 'invitations':
      return env.RATE_LIMITER_INVITATIONS
    case 'assistant':
      return env.RATE_LIMITER_ASSISTANT
    case 'mcp':
      return env.RATE_LIMITER_MCP
  }
}

export const makeRateLimiterLayer = (
  env: RateLimitBindings
): Layer.Layer<RateLimiter> =>
  Layer.succeed(RateLimiter)(
    makeRateLimiter({
      binding: (bucket) => pickBinding(env, bucket),
      fallbackLimits: FALLBACK_LIMITS
    })
  )

export { clientKey }
