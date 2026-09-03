import { writeFileSync } from 'node:fs'
import {
  apiRateLimits,
  billingConsumerSettings,
  billingQueueName,
  notificationDigestCron,
  notificationEmailConsumerSettings,
  notificationEmailQueueName,
  webRateLimits,
  webhookConsumerSettings,
  webhookDeadLetterQueueName,
  webhookDlqConsumerSettings,
  webhookQueueName,
  workerCompatibility,
  workspaceExportBucketName,
  workspaceExportConsumerSettings,
  workspaceExportQueueName,
  type QueueConsumerSettings,
  type RateLimitBindingSpec
} from './bindings.ts'

/**
 * Emits every `apps/<worker>/wrangler.jsonc` from the specs in `bindings.ts`.
 *
 * The configs used to be hand-written and policed by a drift test with its own
 * JSONC lexer, which knew three of the seven binding kinds — which is how a web
 * worker shipped with no compatibility date. Generating them removes the second
 * source of truth instead of testing the two into agreement: run
 * `pnpm run infra:wrangler` after changing a spec, and CI's
 * `git diff --exit-code` fails on a config edited by hand.
 */

const D1_DATABASE_NAME = 'b2b-saas-starter'
const AI_BINDING = 'AI'
const WEBHOOK_QUEUE_BINDING = 'WEBHOOK_QUEUE'
const BILLING_QUEUE_BINDING = 'BILLING_QUEUE'
const WORKSPACE_EXPORT_QUEUE_BINDING = 'WORKSPACE_EXPORT_QUEUE'
const WORKSPACE_EXPORT_BUCKET_BINDING = 'WORKSPACE_EXPORT_BUCKET'

/**
 * The export bucket, on every worker: the web worker reads it to decide whether
 * exports are available, the API worker streams downloads from it, and the
 * background worker writes the archives. Miniflare simulates R2 locally, so the
 * binding is unconditional here; alchemy gates it on `WORKSPACE_EXPORT_BUCKET`.
 */
const workspaceExportBucket = {
  binding: WORKSPACE_EXPORT_BUCKET_BINDING,
  bucket_name: workspaceExportBucketName
}

const workspaceExportProducer = {
  binding: WORKSPACE_EXPORT_QUEUE_BINDING,
  queue: workspaceExportQueueName
}
const NOTIFICATION_EMAIL_QUEUE_BINDING = 'NOTIFICATION_EMAIL_QUEUE'

/** Producer only: seat-sync messages the background worker consumes. */
const billingQueueProducer = {
  binding: BILLING_QUEUE_BINDING,
  queue: billingQueueName
}

type WranglerRateLimit = {
  readonly name: string
  readonly type: 'ratelimit'
  readonly namespace_id: string
  readonly simple: { readonly limit: number; readonly period: 10 | 60 }
}

type WranglerConsumer = {
  queue: string
  max_batch_size: number
  max_batch_timeout: number
  max_retries: number
  max_concurrency: number
  retry_delay?: number
  dead_letter_queue?: string
}

type WorkerDefaults = {
  readonly $schema: string
  readonly name: string
  readonly main: string
  readonly compatibility_date: string
  readonly compatibility_flags: ReadonlyArray<string>
  readonly observability: { readonly enabled: true; readonly head_sampling_rate: 1 }
  readonly d1_databases: ReadonlyArray<{
    readonly binding: string
    readonly database_name: string
    /** Replaced by `wrangler … --remote` at command time. */
    readonly database_id: 'placeholder'
  }>
}

type WranglerConfig = WorkerDefaults & {
  readonly placement?: { readonly mode: 'smart' }
  readonly ai?: { readonly binding: string }
  readonly queues?: {
    readonly producers?: ReadonlyArray<{
      readonly binding: string
      readonly queue: string
    }>
    readonly consumers?: ReadonlyArray<WranglerConsumer>
  }
  readonly r2_buckets?: ReadonlyArray<{
    readonly binding: string
    readonly bucket_name: string
  }>
  readonly triggers?: { readonly crons: ReadonlyArray<string> }
  readonly vars?: Record<string, string>
  readonly unsafe?: { readonly bindings: ReadonlyArray<WranglerRateLimit> }
}

/** Wrangler spells the consumer knobs differently from Alchemy, and in seconds. */
function consumer(
  queue: string,
  settings: QueueConsumerSettings,
  deadLetterQueue?: string
): WranglerConsumer {
  const row: WranglerConsumer = {
    queue,
    max_batch_size: settings.batchSize,
    max_batch_timeout: settings.maxWaitTimeMs / 1000,
    max_retries: settings.maxRetries,
    max_concurrency: settings.maxConcurrency
  }
  if (settings.retryDelay !== undefined) {
    row.retry_delay = settings.retryDelay
  }
  if (deadLetterQueue !== undefined) {
    row.dead_letter_queue = deadLetterQueue
  }
  return row
}

function rateLimits(
  specs: ReadonlyArray<RateLimitBindingSpec>
): ReadonlyArray<WranglerRateLimit> {
  return specs.map((spec) => ({
    name: spec.name,
    type: 'ratelimit',
    namespace_id: spec.namespaceId,
    simple: { limit: spec.limit, period: spec.period }
  }))
}

function workerDefaults(name: string, entry: string): WorkerDefaults {
  return {
    $schema: 'node_modules/wrangler/config-schema.json',
    name: `b2b-saas-starter-${name}`,
    main: entry,
    compatibility_date: workerCompatibility.date,
    compatibility_flags: workerCompatibility.flags,
    observability: { enabled: true, head_sampling_rate: 1 },
    d1_databases: [
      {
        binding: 'DB',
        database_name: D1_DATABASE_NAME,
        database_id: 'placeholder'
      }
    ]
  }
}

export const wranglerConfigs: ReadonlyArray<{
  readonly path: string
  readonly config: WranglerConfig
}> = [
  {
    path: 'apps/web/wrangler.jsonc',
    config: {
      ...workerDefaults('web', 'src/server.ts'),
      ai: { binding: AI_BINDING },
      // Producers only: membership and invitation mutations enqueue seat-sync
      // messages the background worker consumes (`Billing.syncSeats`),
      // workspace settings enqueues export jobs, and every surface that
      // creates a Notification enqueues its instant email.
      queues: {
        producers: [
          billingQueueProducer,
          workspaceExportProducer,
          {
            binding: NOTIFICATION_EMAIL_QUEUE_BINDING,
            queue: notificationEmailQueueName
          }
        ]
      },
      r2_buckets: [workspaceExportBucket],
      vars: { WORKERS_AI_ENABLED: 'false' },
      unsafe: { bindings: rateLimits(webRateLimits) }
    }
  },
  {
    path: 'apps/api/wrangler.jsonc',
    config: {
      ...workerDefaults('api', 'src/index.ts'),
      // Smart placement is for the worker-only services; the web worker serves
      // the document and stays where the eyeball is.
      placement: { mode: 'smart' },
      ai: { binding: AI_BINDING },
      queues: {
        producers: [
          { binding: WEBHOOK_QUEUE_BINDING, queue: webhookQueueName },
          workspaceExportProducer,
          {
            binding: NOTIFICATION_EMAIL_QUEUE_BINDING,
            queue: notificationEmailQueueName
          }
        ]
      },
      r2_buckets: [workspaceExportBucket],
      vars: {
        WORKERS_AI_ENABLED: 'false',
        CLOUDFLARE_EMAIL_FROM: 'noreply@example.com'
      },
      unsafe: { bindings: rateLimits(apiRateLimits) }
    }
  },
  {
    path: 'apps/background/wrangler.jsonc',
    config: {
      ...workerDefaults('background', 'src/index.ts'),
      placement: { mode: 'smart' },
      queues: {
        producers: [
          { binding: WEBHOOK_QUEUE_BINDING, queue: webhookQueueName },
          // The worker creates Notifications too (webhook deliveries that gave
          // up), so it produces instant-email messages for its own consumer.
          {
            binding: NOTIFICATION_EMAIL_QUEUE_BINDING,
            queue: notificationEmailQueueName
          }
        ],
        consumers: [
          consumer(
            webhookQueueName,
            webhookConsumerSettings,
            webhookDeadLetterQueueName
          ),
          // Records terminal `dead_lettered` delivery rows for messages that
          // exhausted max_retries on the primary queue.
          consumer(webhookDeadLetterQueueName, webhookDlqConsumerSettings),
          // Builds workspace export archives and writes them to R2.
          consumer(workspaceExportQueueName, workspaceExportConsumerSettings),
          // Mirrors each workspace's member count onto its Stripe
          // subscription item (seat sync); self-healing, so no DLQ.
          consumer(billingQueueName, billingConsumerSettings),
          // Sends one instant notification email per queue message.
          consumer(notificationEmailQueueName, notificationEmailConsumerSettings)
        ]
      },
      r2_buckets: [workspaceExportBucket],
      // The daily notification digest (ADR 0057).
      triggers: { crons: [notificationDigestCron] },
      // Links in notification emails point at the web app; local dev has no
      // alchemy to forward the deploy value.
      vars: { BETTER_AUTH_URL: 'http://localhost:3071' }
    }
  }
]

const HEADER = `// Generated by \`pnpm run infra:wrangler\` from infra/bindings.ts and
// infra/write-wrangler.ts. Do not edit — change the spec and re-run, or CI's
// \`git diff --exit-code\` will fail. Alchemy reads the same specs, so a worker
// cannot drift from its production deploy.
`

export function renderWranglerConfig(config: WranglerConfig): string {
  return `${HEADER}${JSON.stringify(config, null, 2)}\n`
}

function writeAll(): void {
  const root = new URL('..', import.meta.url).pathname
  for (const { path, config } of wranglerConfigs) {
    writeFileSync(`${root}${path}`, renderWranglerConfig(config))
    process.stdout.write(`wrote ${path}\n`)
  }
}

if (process.argv[1] === import.meta.filename) {
  writeAll()
}
