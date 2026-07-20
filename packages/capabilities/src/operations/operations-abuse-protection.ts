import { Effect, type Scope } from 'effect'
import type { PromiseDrizzleDatabase } from '@b2b-saas-starter/db'
import { makeRateLimiter, type CloudflareRateLimit } from '@b2b-saas-starter/rate-limit'
import {
  OperationsRateLimit,
  makeOperationsRateLimitAuditRecorder,
  makeOperationsRateLimitLayer,
  type OperationsRateLimitDecision,
  type OperationsRateLimitRequest
} from './operations-contracts.ts'

export type OperationsRateLimitCategory = OperationsRateLimitRequest['category']

export type OperationsAbuseBindings = {
  readonly read?: CloudflareRateLimit
  readonly authentication?: CloudflareRateLimit
  readonly totp?: CloudflareRateLimit
  readonly search?: CloudflareRateLimit
  readonly management?: CloudflareRateLimit
  readonly impersonationStart?: CloudflareRateLimit
  readonly handoffExchange?: CloudflareRateLimit
}

const categories: readonly OperationsRateLimitCategory[] = [
  'operator-session-read',
  'operator-authentication',
  'operator-totp',
  'merchant-discovery',
  'operator-management',
  'impersonation-start',
  'handoff-exchange'
]

const bindingFor = (
  bindings: OperationsAbuseBindings,
  category: OperationsRateLimitCategory
): CloudflareRateLimit | undefined => {
  switch (category) {
    case 'operator-session-read':
      return bindings.read
    case 'operator-authentication':
      return bindings.authentication
    case 'operator-totp':
      return bindings.totp
    case 'merchant-discovery':
      return bindings.search
    case 'operator-management':
      return bindings.management
    case 'impersonation-start':
      return bindings.impersonationStart
    case 'handoff-exchange':
      return bindings.handoffExchange
  }
}

const runScoped = <A>(effect: Effect.Effect<A, never, Scope.Scope>): Promise<A> =>
  Effect.runPromise(Effect.scoped(effect) as Effect.Effect<A>)

export const makeOperationsAbuseProtection = (input: {
  readonly db: PromiseDrizzleDatabase
  readonly bindings: OperationsAbuseBindings
  readonly fallbackLimits: Readonly<
    Partial<Record<OperationsRateLimitCategory, number>>
  >
  readonly retryAfterSeconds: number
  readonly now?: () => Date
}): {
  readonly consume: (
    request: OperationsRateLimitRequest
  ) => Promise<OperationsRateLimitDecision>
} => {
  const fallbackLimits = Object.fromEntries(
    categories.map((category) => [category, input.fallbackLimits[category] ?? 1])
  ) as Record<OperationsRateLimitCategory, number>
  const limiter = makeRateLimiter<OperationsRateLimitCategory>({
    binding: (category) => bindingFor(input.bindings, category),
    fallbackLimits
  })
  const layer = makeOperationsRateLimitLayer({
    adapter: {
      consume: ({ category, key }) =>
        runScoped(limiter.take({ bucket: category, key })),
      recordDenied: makeOperationsRateLimitAuditRecorder(input.db)
    },
    retryAfterSeconds: Object.fromEntries(
      categories.map((category) => [category, input.retryAfterSeconds])
    ) as Record<OperationsRateLimitCategory, number>,
    ...(input.now ? { now: input.now } : {})
  })

  return {
    consume: (request) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const rateLimit = yield* OperationsRateLimit
          return yield* rateLimit.consume(request)
        }).pipe(Effect.provide(layer))
      )
  }
}
