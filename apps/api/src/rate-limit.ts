import { RateLimiter, type RateLimitBucket } from '@b2b-saas-starter/api'
import {
  apiFallbackLimits,
  apiRateLimitBindingNames,
  type ApiRateLimitBindingName
} from '@b2b-saas-starter/infra'
import { makeRateLimiter, type CloudflareRateLimit } from '@b2b-saas-starter/rate-limit'
import { Layer } from 'effect'

// Thin config module over @b2b-saas-starter/rate-limit: the binding names and
// fallback limits come from `@b2b-saas-starter/infra` — the same records the
// generated wrangler config and Alchemy's bindings are emitted from — so this
// file owns only the mechanism wiring. The mechanism (Cloudflare binding
// dispatch, module-scope in-memory fallback, degraded-mode telemetry,
// clientKey) lives in the shared package, and the bucket union plus the
// `RateLimiter` service live on the contract beside the `BearerAuth`
// middleware that draws from them.

// The env type is derived from the infra name record, not spelled: renaming a
// binding in infra renames the key here and in the generated wrangler config
// together, and a bucket added to infra surfaces here the moment its row is
// written.
export type RateLimitBindings = Readonly<
  Partial<Record<ApiRateLimitBindingName, CloudflareRateLimit>>
>

export { RateLimiter, type RateLimitBucket }

// The numbers live beside the specs in infra; the annotation fails the build
// if the contract ever names a bucket the infra table does not carry.
const FALLBACK_LIMITS: Record<RateLimitBucket, number> = apiFallbackLimits

function pickBinding(
  env: RateLimitBindings,
  bucket: RateLimitBucket
): CloudflareRateLimit | undefined {
  return env[apiRateLimitBindingNames[bucket]]
}

export function makeRateLimiterLayer(env: RateLimitBindings): Layer.Layer<RateLimiter> {
  return Layer.succeed(RateLimiter)(
    makeRateLimiter({
      binding: (bucket) => pickBinding(env, bucket),
      fallbackLimits: FALLBACK_LIMITS
    })
  )
}
