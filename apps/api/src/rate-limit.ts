import { Context, Effect, HashMap, Layer, Ref } from 'effect'

// Cloudflare Rate Limiting binding shape (subset). The actual binding is
// provisioned via wrangler.jsonc (`unsafe.bindings`) and alchemy.run.ts;
// declared here so we can type the env without depending on
// @cloudflare/workers-types directly.
type CloudflareRateLimit = {
  readonly limit: (input: { readonly key: string }) => Promise<{
    readonly success: boolean
  }>
}

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

export type RateLimitInput = {
  readonly bucket: RateLimitBucket
  readonly key: string
}

export type RateLimiterShape = {
  readonly take: (input: RateLimitInput) => Effect.Effect<boolean>
}

export class RateLimiter extends Context.Service<RateLimiter, RateLimiterShape>()(
  '@b2b-saas-starter/api/RateLimiter'
) {}

// Per-isolate fallback window for local dev and tests where no
// Cloudflare RateLimit binding is provided.
const FALLBACK_WINDOW_MS = 60_000
const FALLBACK_LIMITS: Record<RateLimitBucket, number> = {
  rest_read: 60,
  rest_write: 20,
  invitations: 10,
  assistant: 20,
  mcp: 30
}

type BucketState = { readonly count: number; readonly resetAt: number }

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
              // If the binding call failed (e.g. transient platform
              // error), fall through to the in-memory brake rather
              // than failing open.
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
  // Without a client IP we can't bucket fairly. Use the request URL so a
  // single misconfigured caller can't share the bucket with everyone else.
  return `unkeyed:${new URL(request.url).pathname}`
}
