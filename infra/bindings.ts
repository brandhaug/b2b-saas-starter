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

export const apiRateLimits: ReadonlyArray<RateLimitBindingSpec> = [
  { name: 'RATE_LIMITER_REST', namespaceId: '1001', limit: 60, period: 60 },
  { name: 'RATE_LIMITER_REST_WRITE', namespaceId: '1002', limit: 20, period: 60 },
  { name: 'RATE_LIMITER_ASSISTANT', namespaceId: '1004', limit: 20, period: 60 },
  { name: 'RATE_LIMITER_MCP', namespaceId: '1005', limit: 30, period: 60 }
]

export const webRateLimits: ReadonlyArray<RateLimitBindingSpec> = [
  { name: 'RATE_LIMITER_AUTH_READ', namespaceId: '2001', limit: 60, period: 60 },
  { name: 'RATE_LIMITER_AUTH_WRITE', namespaceId: '2002', limit: 20, period: 60 },
  // Credential sign-in only — tighter than the generic write bucket so a
  // credential-stuffing attacker does not get twenty password guesses/min/IP.
  { name: 'RATE_LIMITER_AUTH_SIGN_IN', namespaceId: '2003', limit: 5, period: 60 }
]

export const webhookQueueName = 'b2b-saas-starter-webhooks'
export const webhookDeadLetterQueueName = 'b2b-saas-starter-webhooks-dlq'

/**
 * One compatibility date for every worker — production (alchemy.run.ts) and
 * local dev (each wrangler.jsonc) must run the same runtime behavior. Kept
 * here so changing the date cannot leave one worker behind: the drift test
 * asserts all three wrangler configs and the alchemy stack agree.
 */
export type WorkerCompatibility = {
  readonly date: string
  readonly flags: ReadonlyArray<string>
}

export const workerCompatibility = {
  date: '2026-05-16',
  flags: ['nodejs_compat']
} satisfies WorkerCompatibility

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

export const webhookConsumerSettings: QueueConsumerSettings = {
  batchSize: 25,
  maxConcurrency: 4,
  maxRetries: 6,
  maxWaitTimeMs: 5000,
  retryDelay: 30
}

// Dead-letter consumer: records terminal `dead_lettered` delivery rows, so a
// single low-concurrency attempt is enough.
export const webhookDlqConsumerSettings: QueueConsumerSettings = {
  batchSize: 25,
  maxConcurrency: 1,
  maxRetries: 1,
  maxWaitTimeMs: 5000
}
