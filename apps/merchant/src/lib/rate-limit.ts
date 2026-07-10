import { Effect, type Scope } from 'effect'
import {
  makeRateLimiter,
  type CloudflareRateLimit,
  type RateLimiterShape
} from '@b2b-saas-starter/rate-limit'

type MerchantAuthRateLimitBucket = 'auth_read' | 'auth_write'

export type MerchantRateLimitBindings = {
  readonly RATE_LIMITER_AUTH_READ?: CloudflareRateLimit
  readonly RATE_LIMITER_AUTH_WRITE?: CloudflareRateLimit
}

const fallbackLimits: Record<MerchantAuthRateLimitBucket, number> = {
  auth_read: 60,
  auth_write: 20
}

const runScoped = <A>(effect: Effect.Effect<A, never, Scope.Scope>): Promise<A> =>
  Effect.runPromise(Effect.scoped(effect) as Effect.Effect<A>)

export const createMerchantRateLimiter = (
  env: MerchantRateLimitBindings
): {
  readonly take: (
    input: Parameters<RateLimiterShape<MerchantAuthRateLimitBucket>['take']>[0]
  ) => Promise<boolean>
} => {
  const limiter = makeRateLimiter({
    binding: (bucket) =>
      bucket === 'auth_read' ? env.RATE_LIMITER_AUTH_READ : env.RATE_LIMITER_AUTH_WRITE,
    fallbackLimits
  })
  return { take: (input) => runScoped(limiter.take(input)) }
}
