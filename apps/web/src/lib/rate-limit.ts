import {
  clientKey,
  makeRateLimiter,
  type CloudflareRateLimit,
  type RateLimitInput as GenericRateLimitInput,
  type RateLimiterInterface as GenericRateLimiterInterface
} from '@b2b-saas-starter/rate-limit'
import { Context, Layer } from 'effect'

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
  readonly RATE_LIMITER_AUTH_SIGN_IN?: CloudflareRateLimit
}

type AuthRateLimitBucket = 'auth_read' | 'auth_write' | 'auth_sign_in'

export type RateLimitInput = GenericRateLimitInput<AuthRateLimitBucket>

export type RateLimiterInterface = GenericRateLimiterInterface<AuthRateLimitBucket>

export class RateLimiter extends Context.Service<RateLimiter, RateLimiterInterface>()(
  '@b2b-saas-starter/web/RateLimiter'
) {}

// Credential endpoints get their own, much tighter bucket: the generic write
// bucket's 20/min is fine for session management POSTs, but a credential-
// stuffing attacker should not get twenty password guesses per minute per IP.
const FALLBACK_LIMITS = {
  auth_read: 60,
  auth_write: 20,
  auth_sign_in: 5
} satisfies Record<AuthRateLimitBucket, number>

function pickBinding(
  env: RateLimitBindings,
  bucket: AuthRateLimitBucket
): CloudflareRateLimit | undefined {
  switch (bucket) {
    case 'auth_read': {
      return env.RATE_LIMITER_AUTH_READ
    }
    case 'auth_write': {
      return env.RATE_LIMITER_AUTH_WRITE
    }
    case 'auth_sign_in': {
      return env.RATE_LIMITER_AUTH_SIGN_IN
    }
  }
}

/**
 * Bucket selection for an auth request: credential sign-in endpoints
 * (`/sign-in/email`, `/sign-in/username`) land in `auth_sign_in`; other POSTs
 * in `auth_write`; everything else in `auth_read`.
 */
export function authRateLimitBucket(
  method: string,
  pathname: string
): AuthRateLimitBucket {
  if (
    method === 'POST' &&
    (pathname.endsWith('/sign-in/email') || pathname.endsWith('/sign-in/username'))
  ) {
    return 'auth_sign_in'
  }
  return method === 'POST' ? 'auth_write' : 'auth_read'
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
