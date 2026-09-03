// Single source of truth for the binding shapes that must agree between
// `alchemy.run.ts` (production deploys) and `apps/*/wrangler.jsonc` (local
// `wrangler dev`). Alchemy imports these constants directly and
// `write-wrangler.ts` generates the wrangler configs from them, so there is
// one source rather than two under a drift test. Change a limit or consumer
// setting HERE, then run `pnpm run infra:wrangler`.

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
 * One compatibility date and flag set for every worker — production
 * (alchemy.run.ts) and local dev (each generated wrangler.jsonc) must run the
 * same runtime behavior, so changing the date cannot leave one worker behind.
 * `nodejs_compat` is required: `@sentry/cloudflare` needs AsyncLocalStorage
 * (see packages/logger/src/providers.ts).
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

/**
 * Stage-aware physical names. `prod` keeps the historical names so the
 * production stack's D1, queues, and Workers are untouched; every other stage
 * (a `pr-<number>` preview, a developer's `dev_<user>`) gets its own copies
 * under `b2b-saas-starter-<stage>-…`, so two stages never share a database or
 * a queue. `write-wrangler.ts` renders the `prod` names, which is why
 * `pnpm run infra:wrangler` output does not move when a preview deploys.
 */
export const productionStage = 'prod'

export const stageNamePattern = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/

/** `pr-<number>` stages are the ephemeral per-pull-request previews (ADR 0054). */
export function isPreviewStage(stage: string): boolean {
  return /^pr-\d+$/.test(stage)
}

export type WorkerApp = 'web' | 'api' | 'background'

export type StageResourceNames = {
  readonly stage: string
  readonly database: string
  readonly webhookQueue: string
  readonly webhookDeadLetterQueue: string
  readonly workspaceExportQueue: string
  readonly workspaceExportBucket: string
  readonly worker: (app: WorkerApp) => string
}

export function stageResourceNames(stage: string): StageResourceNames {
  if (!stageNamePattern.test(stage)) {
    throw new Error(
      `Invalid stage "${stage}": use lowercase letters, digits, "-" or "_" (e.g. prod, pr-42).`
    )
  }
  if (stage === productionStage) {
    return {
      stage,
      database: 'b2b-saas-starter',
      webhookQueue: webhookQueueName,
      webhookDeadLetterQueue: webhookDeadLetterQueueName,
      workspaceExportQueue: workspaceExportQueueName,
      workspaceExportBucket: workspaceExportBucketName,
      worker: (app) => `b2b-saas-starter-${app}`
    }
  }
  const prefix = `b2b-saas-starter-${stage}`
  return {
    stage,
    database: prefix,
    webhookQueue: `${prefix}-webhooks`,
    webhookDeadLetterQueue: `${prefix}-webhooks-dlq`,
    workspaceExportQueue: `${prefix}-workspace-exports`,
    workspaceExportBucket: `${prefix}-workspace-exports`,
    worker: (app) => `${prefix}-${app}`
  }
}

/**
 * The `workers.dev` URL a Worker serves at when it has no custom domain:
 * `https://<worker>.<account subdomain>.workers.dev`. The preview workflow and
 * `alchemy.run.ts` derive `BETTER_AUTH_URL` and the sticky PR comment from
 * this, so the two can never disagree about where a preview lives.
 */
export function workersDevUrl(workerName: string, subdomain: string): string {
  return `https://${workerName}.${subdomain}.workers.dev`
}

// Workspace data export (ADR 0054). One queue carries export jobs from the
// requesting worker to the background worker, and one R2 bucket holds the
// finished ZIP artifacts. Both are provisioned only when
// `WORKSPACE_EXPORT_BUCKET` is set at deploy time; the generated wrangler
// configs always carry them because miniflare simulates both locally.
export const workspaceExportQueueName = 'b2b-saas-starter-workspace-exports'
export const workspaceExportBucketName = 'b2b-saas-starter-workspace-exports'

/**
 * How long an export artifact lives. The R2 lifecycle rule deletes the object
 * after this many days, and `WorkspaceExports` stamps the same horizon onto the
 * export row's `expiresAt` so the UI and the bucket agree on when a download
 * link stops working.
 */
export const WORKSPACE_EXPORT_RETENTION_DAYS = 7

// One export per invocation: an export reads every table of a workspace and
// builds the archive in memory, so concurrency buys nothing and a batch of
// twenty-five would only multiply the memory footprint. Three attempts, a
// minute apart; the consumer marks the export failed on the last one.
export const workspaceExportConsumerSettings: QueueConsumerSettings = {
  batchSize: 1,
  maxConcurrency: 1,
  maxRetries: 3,
  maxWaitTimeMs: 1000,
  retryDelay: 60
}
