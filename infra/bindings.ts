// Single source of truth for the binding shapes that must agree between
// `alchemy.run.ts` (production deploys) and `apps/*/wrangler.jsonc` (local
// `wrangler dev`). Alchemy imports these constants directly; the wrangler
// configs are hand-written JSONC, so `bindings.test.ts` parses them and fails
// red on any drift. Change a limit or consumer setting HERE, then update the
// matching wrangler.jsonc until the drift test passes.

export type RateLimitBindingSpec = {
  readonly name: string
  readonly namespaceId: string
  readonly limit: number
  readonly period: 10 | 60
}

export const apiRateLimits: readonly RateLimitBindingSpec[] = [
  { name: 'RATE_LIMITER_DATA_READ', namespaceId: '1006', limit: 60, period: 60 },
  {
    name: 'RATE_LIMITER_DEVELOPER_CONFIG',
    namespaceId: '1007',
    limit: 20,
    period: 60
  },
  { name: 'RATE_LIMITER_AUTH_FAILURE', namespaceId: '1008', limit: 30, period: 60 }
]

// Merchant authentication is intentionally isolated from the legacy Public
// Site auth buckets while that surface is still being contracted. The binding
// names stay familiar to the shared auth adapter; the namespaces do not.
export const merchantRateLimits: readonly RateLimitBindingSpec[] = [
  { name: 'RATE_LIMITER_AUTH_READ', namespaceId: '3001', limit: 60, period: 60 },
  { name: 'RATE_LIMITER_AUTH_WRITE', namespaceId: '3002', limit: 20, period: 60 }
]

export const operationsRateLimits: readonly RateLimitBindingSpec[] = [
  {
    name: 'RATE_LIMITER_OPERATIONS_READ',
    namespaceId: '5001',
    limit: 120,
    period: 60
  },
  {
    name: 'RATE_LIMITER_OPERATIONS_AUTHENTICATION',
    namespaceId: '5002',
    limit: 10,
    period: 60
  },
  {
    name: 'RATE_LIMITER_OPERATIONS_TOTP',
    namespaceId: '5003',
    limit: 5,
    period: 60
  },
  {
    name: 'RATE_LIMITER_OPERATIONS_SEARCH',
    namespaceId: '5004',
    limit: 30,
    period: 60
  },
  {
    name: 'RATE_LIMITER_OPERATIONS_MANAGEMENT',
    namespaceId: '5005',
    limit: 20,
    period: 60
  },
  {
    name: 'RATE_LIMITER_OPERATIONS_IMPERSONATION_START',
    namespaceId: '5006',
    limit: 10,
    period: 60
  },
  {
    name: 'RATE_LIMITER_OPERATIONS_HANDOFF_EXCHANGE',
    namespaceId: '5007',
    limit: 10,
    period: 60
  }
]

export const merchantImpersonationRateLimits = operationsRateLimits.filter(
  (spec) => spec.name === 'RATE_LIMITER_OPERATIONS_HANDOFF_EXCHANGE'
)

export const operationsRateLimitEnvironment = {
  OPERATIONS_RATE_LIMIT_SESSION_READ: '120',
  OPERATIONS_RATE_LIMIT_AUTHENTICATION: '10',
  OPERATIONS_RATE_LIMIT_TOTP: '5',
  OPERATIONS_RATE_LIMIT_SEARCH: '30',
  OPERATIONS_RATE_LIMIT_MANAGEMENT: '20',
  OPERATIONS_RATE_LIMIT_IMPERSONATION_START: '10',
  OPERATIONS_RATE_LIMIT_HANDOFF_EXCHANGE: '10',
  OPERATIONS_RATE_LIMIT_WINDOW_SECONDS: '60'
} as const

export const bookingRateLimits: readonly RateLimitBindingSpec[] = [
  { name: 'RATE_LIMITER_BOOKING_READ', namespaceId: '4001', limit: 120, period: 60 },
  { name: 'RATE_LIMITER_BOOKING_WRITE', namespaceId: '4002', limit: 30, period: 60 }
]

export const bookingEventsQueueName = 'b2b-saas-starter-booking-events'
export const bookingEventsDeadLetterQueueName =
  'b2b-saas-starter-booking-events-dead-letter'

// Shape matches Alchemy's `QueueConsumer` settings input. Wrangler spells the
// same knobs differently (`max_batch_size`, `max_batch_timeout` in seconds,
// ...) — the drift test owns that translation.
export type QueueConsumerSettings = {
  readonly batchSize: number
  readonly maxConcurrency: number
  readonly maxRetries: number
  readonly maxWaitTimeMs: number
  readonly retryDelay?: number
}

// Booking event messages wake the Background Worker after a committed outbox
// write. The durable outbox remains authoritative, so this queue can use the
// same resilient retry profile as webhook work without becoming booking state.
export const bookingEventsConsumerSettings: QueueConsumerSettings = {
  batchSize: 25,
  maxConcurrency: 1,
  maxRetries: 6,
  maxWaitTimeMs: 5_000,
  retryDelay: 30
}
