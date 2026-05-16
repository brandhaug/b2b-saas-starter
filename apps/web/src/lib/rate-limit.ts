import { Context, Effect, HashMap, Layer, Ref } from 'effect'

type CloudflareRateLimit = {
  readonly limit: (input: { readonly key: string }) => Promise<{
    readonly success: boolean
  }>
}

export type RateLimitBindings = {
  readonly RATE_LIMITER_AUTH_READ?: CloudflareRateLimit
  readonly RATE_LIMITER_AUTH_WRITE?: CloudflareRateLimit
}

export type AuthRateLimitBucket = 'auth_read' | 'auth_write'

export type RateLimitInput = {
  readonly bucket: AuthRateLimitBucket
  readonly key: string
}

export type RateLimiterShape = {
  readonly take: (input: RateLimitInput) => Effect.Effect<boolean>
}

export class RateLimiter extends Context.Service<RateLimiter, RateLimiterShape>()(
  '@b2b-saas-starter/web/RateLimiter'
) {}

const FALLBACK_WINDOW_MS = 60_000
const FALLBACK_LIMITS: Record<AuthRateLimitBucket, number> = {
  auth_read: 60,
  auth_write: 20
}

type BucketState = { readonly count: number; readonly resetAt: number }

const pickBinding = (
  env: RateLimitBindings,
  bucket: AuthRateLimitBucket
): CloudflareRateLimit | undefined =>
  bucket === 'auth_read' ? env.RATE_LIMITER_AUTH_READ : env.RATE_LIMITER_AUTH_WRITE

export const makeRateLimiterLayer = (
  env: RateLimitBindings
): Layer.Layer<RateLimiter> =>
  Layer.effect(RateLimiter)(
    Effect.gen(function* () {
      const fallback = yield* Ref.make(HashMap.empty<string, BucketState>())
      return {
        take: (input) =>
          Effect.gen(function* () {
            const binding = pickBinding(env, input.bucket)
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
            return yield* Ref.modify(fallback, (state) => {
              const id = `${input.bucket}:${input.key}`
              const now = Date.now()
              const existing = HashMap.get(state, id)
              if (existing._tag === 'None' || existing.value.resetAt < now) {
                return [
                  true,
                  HashMap.set(state, id, {
                    count: 1,
                    resetAt: now + FALLBACK_WINDOW_MS
                  })
                ] as const
              }
              if (existing.value.count >= FALLBACK_LIMITS[input.bucket]) {
                return [false, state] as const
              }
              return [
                true,
                HashMap.set(state, id, {
                  count: existing.value.count + 1,
                  resetAt: existing.value.resetAt
                })
              ] as const
            })
          })
      }
    })
  )

export const clientKey = (request: Request): string => {
  const ip =
    request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for')
  if (ip) return ip
  return `unkeyed:${new URL(request.url).pathname}`
}
