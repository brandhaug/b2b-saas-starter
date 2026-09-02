import { writeFileSync } from 'node:fs'
import {
  apiRateLimits,
  webRateLimits,
  webhookConsumerSettings,
  webhookDeadLetterQueueName,
  webhookDlqConsumerSettings,
  webhookQueueName,
  workerCompatibility,
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
        producers: [{ binding: WEBHOOK_QUEUE_BINDING, queue: webhookQueueName }]
      },
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
        producers: [{ binding: WEBHOOK_QUEUE_BINDING, queue: webhookQueueName }],
        consumers: [
          consumer(
            webhookQueueName,
            webhookConsumerSettings,
            webhookDeadLetterQueueName
          ),
          // Records terminal `dead_lettered` delivery rows for messages that
          // exhausted max_retries on the primary queue.
          consumer(webhookDeadLetterQueueName, webhookDlqConsumerSettings)
        ]
      }
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
