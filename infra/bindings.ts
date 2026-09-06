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

/**
 * The rate-limit buckets each worker's code names. The app shims
 * (`apps/api/src/env.ts`, `apps/web/src/lib/rate-limit.ts`,
 * `apps/web/src/worker-env.d.ts`) derive their env types and resolvers from
 * these unions, so a bucket added here fails their build until its row below
 * (and the contract's bucket union) exists — the buckets cannot drift between
 * infra and the apps the way hand-spelled names could.
 */
export type ApiRateLimitBucket = 'rest_read' | 'rest_write' | 'assistant' | 'mcp'
export type WebRateLimitBucket = 'auth_read' | 'auth_write' | 'auth_sign_in'

/**
 * Bucket → binding name: the ONE place each rate-limit binding name is
 * spelled — the union types below are derived from these records, not written
 * out again. The specs below bind these names into the generated wrangler
 * configs and Alchemy's worker envs, and the app shims resolve their env
 * through them, so renaming a binding is one row here and the whole chain
 * moves together.
 */
// oxlint-disable-next-line effect/noAs -- `as const`, not a type assertion
export const apiRateLimitBindingNames = {
  rest_read: 'RATE_LIMITER_REST',
  rest_write: 'RATE_LIMITER_REST_WRITE',
  assistant: 'RATE_LIMITER_ASSISTANT',
  mcp: 'RATE_LIMITER_MCP'
} as const satisfies Record<ApiRateLimitBucket, string>

// oxlint-disable-next-line effect/noAs -- `as const`, not a type assertion
export const webRateLimitBindingNames = {
  auth_read: 'RATE_LIMITER_AUTH_READ',
  auth_write: 'RATE_LIMITER_AUTH_WRITE',
  auth_sign_in: 'RATE_LIMITER_AUTH_SIGN_IN'
} as const satisfies Record<WebRateLimitBucket, string>

/** The binding names themselves, for env types keyed by binding. */
export type ApiRateLimitBindingName =
  (typeof apiRateLimitBindingNames)[ApiRateLimitBucket]

export type WebRateLimitBindingName =
  (typeof webRateLimitBindingNames)[WebRateLimitBucket]

// Namespace, budget, and window per bucket — keyed by bucket like the names.
const apiRateLimitTuning = {
  rest_read: { namespaceId: '1001', limit: 60, period: 60 },
  rest_write: { namespaceId: '1002', limit: 20, period: 60 },
  assistant: { namespaceId: '1004', limit: 20, period: 60 },
  mcp: { namespaceId: '1005', limit: 30, period: 60 }
} satisfies Record<ApiRateLimitBucket, Omit<RateLimitBindingSpec, 'name'>>

// Credential sign-in only — tighter than the generic write bucket so a
// credential-stuffing attacker does not get twenty password guesses/min/IP.
const webRateLimitTuning = {
  auth_read: { namespaceId: '2001', limit: 60, period: 60 },
  auth_write: { namespaceId: '2002', limit: 20, period: 60 },
  auth_sign_in: { namespaceId: '2003', limit: 5, period: 60 }
} satisfies Record<WebRateLimitBucket, Omit<RateLimitBindingSpec, 'name'>>

/**
 * Joins the name and tuning tables into the specs the two emitters bind, and
 * the per-bucket budgets the app shims install as their in-memory fallback
 * limits. One cast, contained: `Object.fromEntries` widens the key, while the
 * `Record<Bucket, _>` return type owns exhaustiveness.
 */
/** What `rateLimitSpecs` joins a name table and a tuning table into. */
type RateLimitTable<Bucket extends string> = {
  readonly specs: Array<RateLimitBindingSpec>
  readonly fallbackLimits: Record<Bucket, number>
}

function rateLimitSpecs<Bucket extends string>(
  names: Record<Bucket, string>,
  tuning: Record<Bucket, Omit<RateLimitBindingSpec, 'name'>>
): RateLimitTable<Bucket> {
  // SAFETY: Object.keys erases literal keys, but every key of `tuning` is a
  // `Bucket` — the `Record<Bucket, _>` parameters own that exhaustiveness —
  // so the assertion only restores what the operator dropped.
  // oxlint-disable-next-line effect/noAs, typescript/no-unsafe-type-assertion -- see SAFETY above
  const buckets = Object.keys(tuning) as Array<Bucket>
  return {
    specs: buckets.map((bucket) => ({ name: names[bucket], ...tuning[bucket] })),
    // SAFETY: Object.fromEntries widens the key the same way Object.keys
    // does; the `RateLimitTable` return annotation is the check.
    // oxlint-disable-next-line effect/noAs, typescript/no-unsafe-type-assertion -- see SAFETY above
    fallbackLimits: Object.fromEntries(
      buckets.map((bucket) => [bucket, tuning[bucket].limit])
    ) as Record<Bucket, number>
  }
}

const apiRateLimitTable = rateLimitSpecs(apiRateLimitBindingNames, apiRateLimitTuning)
const webRateLimitTable = rateLimitSpecs(webRateLimitBindingNames, webRateLimitTuning)

/** The specs `alchemy.run.ts` and `infra/write-wrangler.ts` both emit. */
export const apiRateLimits: ReadonlyArray<RateLimitBindingSpec> =
  apiRateLimitTable.specs

export const webRateLimits: ReadonlyArray<RateLimitBindingSpec> =
  webRateLimitTable.specs

/** The per-bucket budgets behind the specs' `limit`, importable once. */
export const apiFallbackLimits: Readonly<Record<ApiRateLimitBucket, number>> =
  apiRateLimitTable.fallbackLimits

export const webFallbackLimits: Readonly<Record<WebRateLimitBucket, number>> =
  webRateLimitTable.fallbackLimits

export const webhookQueueName = 'b2b-saas-starter-webhooks'
export const webhookDeadLetterQueueName = 'b2b-saas-starter-webhooks-dlq'

/**
 * The seat-sync queue. Membership and invitation mutations enqueue one
 * message per change; the background worker consumes it and mirrors the
 * member count onto the Stripe subscription item (`Billing.syncSeats`), so a
 * membership mutation never awaits Stripe. No dead-letter queue on purpose:
 * sync is self-healing — the next mutation re-syncs, and the
 * `customer.subscription.updated` webhook reconciles any drift — so an
 * exhausted message can be dropped rather than replayed.
 */
export const billingQueueName = 'b2b-saas-starter-billing'

export const billingConsumerSettings: QueueConsumerSettings = {
  batchSize: 10,
  maxConcurrency: 2,
  maxRetries: 3,
  maxWaitTimeMs: 5000,
  retryDelay: 30
}

/**
 * Instant notification emails: one message per (Notification, recipient) whose
 * channel preference is `instant`. Produced by the web and API workers (any
 * surface that creates a Notification) and consumed by the background worker,
 * which renders and sends the email. No dead-letter queue on purpose: a
 * message that exhausts its retries is dropped, and the recipient still sees
 * the Notification in the feed and, when they take the digest, in the next
 * digest email.
 */
export const notificationEmailQueueName = 'b2b-saas-starter-notification-emails'

/**
 * The daily digest schedule (ADR 0061): 08:00 UTC, one `scheduled` invocation
 * on the background worker that groups the previous 24 hours of unread
 * Notifications per recipient. Alchemy and wrangler both read this constant.
 */
export const notificationDigestCron = '0 8 * * *'

/**
 * Binding key names: the env-facing half of a queue binding. The physical
 * queue names above are single-sourced already; these keys are the other
 * half a rename could desynchronize between Alchemy's worker `env` objects
 * and the generated wrangler configs, so both emitters read them from this
 * record instead of inlining the strings. `as const` keeps each value a
 * literal type so the per-worker binding-name unions below can derive from
 * them instead of re-spelling the strings.
 */
// oxlint-disable-next-line effect/noAs -- `as const`, not a type assertion
export const queueBindingKeys = {
  webhookQueue: 'WEBHOOK_QUEUE',
  billingQueue: 'BILLING_QUEUE',
  notificationEmailQueue: 'NOTIFICATION_EMAIL_QUEUE',
  workspaceExportQueue: 'WORKSPACE_EXPORT_QUEUE'
} as const satisfies Record<QueueBindingKey, string>

/** The queue bindings a worker's env may carry, by role. */
export type QueueBindingKey =
  | 'webhookQueue'
  | 'billingQueue'
  | 'notificationEmailQueue'
  | 'workspaceExportQueue'

/**
 * The binding names that are neither queues nor rate limits: the D1 database
 * every worker shares, the Workers AI binding the assistant surfaces read,
 * the Cloudflare Email send binding, and the workspace-export R2 bucket
 * (ADR 0055). `alchemy.run.ts` and `infra/write-wrangler.ts` still spell
 * these values inline — the one duplication left in the chain — while the
 * per-worker records below read them from here, so the exported unions have
 * a single home per name.
 */
// oxlint-disable-next-line effect/noAs -- `as const`, not a type assertion
const resourceBindingNames = {
  database: 'DB',
  workersAi: 'AI',
  email: 'EMAIL',
  workspaceExportBucket: 'WORKSPACE_EXPORT_BUCKET'
} as const

/**
 * Per-worker binding-name records: the env-type-facing mirror of the `env`
 * blocks `alchemy.run.ts` binds (`infra/write-wrangler.ts` generates the
 * same sets minus EMAIL — miniflare cannot simulate SendEmail, so local
 * dev never binds it). Values come only from the records above and
 * `queueBindingKeys` — never re-spelled — so a rename there moves the
 * exported `…BindingName` unions, and the worker env types keyed by them
 * (`apps/api/src/env.ts`, `apps/background/src/queue-consumer.ts`,
 * `apps/web/src/worker-env.d.ts`), in one edit. A row added here grows its
 * union, and that env type then fails its typecheck until a binding-type
 * row exists — the keys can no longer drift from the deploy silently. A row
 * says the key EXISTS when the deploy binds it, never that it is present:
 * the env types keep every key optional, because a provider-gated binding
 * (EMAIL, the workspace-export pair) is deliberately absent while its
 * provider is unset. The API worker carries no EMAIL row on purpose — it
 * wires no email dispatcher (apps/api/AGENTS.md), so the binding alchemy
 * spreads into its env simply has no reader there.
 */
// oxlint-disable-next-line effect/noAs -- `as const`, not a type assertion
const apiBindingNames = {
  database: resourceBindingNames.database,
  workersAi: resourceBindingNames.workersAi,
  webhookQueue: queueBindingKeys.webhookQueue,
  notificationEmailQueue: queueBindingKeys.notificationEmailQueue,
  workspaceExportQueue: queueBindingKeys.workspaceExportQueue,
  workspaceExportBucket: resourceBindingNames.workspaceExportBucket
} as const

// oxlint-disable-next-line effect/noAs -- `as const`, not a type assertion
const backgroundBindingNames = {
  database: resourceBindingNames.database,
  webhookQueue: queueBindingKeys.webhookQueue,
  notificationEmailQueue: queueBindingKeys.notificationEmailQueue,
  workspaceExportQueue: queueBindingKeys.workspaceExportQueue,
  workspaceExportBucket: resourceBindingNames.workspaceExportBucket,
  email: resourceBindingNames.email
} as const

// oxlint-disable-next-line effect/noAs -- `as const`, not a type assertion
const webBindingNames = {
  database: resourceBindingNames.database,
  workersAi: resourceBindingNames.workersAi,
  webhookQueue: queueBindingKeys.webhookQueue,
  billingQueue: queueBindingKeys.billingQueue,
  notificationEmailQueue: queueBindingKeys.notificationEmailQueue,
  workspaceExportQueue: queueBindingKeys.workspaceExportQueue,
  workspaceExportBucket: resourceBindingNames.workspaceExportBucket,
  email: resourceBindingNames.email
} as const

/**
 * Every binding name each worker's env may carry. Rate limits join through
 * their own name unions, so a bucket added to a rate-limit name record is
 * picked up without a second row here. Import these into the worker env
 * types as `Partial<Record<…>>`-style keys — never as a claim that any key
 * is present (see the records above).
 */
export type ApiBindingName =
  | ApiRateLimitBindingName
  | (typeof apiBindingNames)[keyof typeof apiBindingNames]

export type BackgroundBindingName =
  (typeof backgroundBindingNames)[keyof typeof backgroundBindingNames]

export type WebBindingName =
  | WebRateLimitBindingName
  | (typeof webBindingNames)[keyof typeof webBindingNames]

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

/** `pr-<number>` stages are the ephemeral per-pull-request previews (ADR 0065). */
export function isPreviewStage(stage: string): boolean {
  return /^pr-\d+$/.test(stage)
}

export type WorkerApp = 'web' | 'api' | 'background'

/**
 * Each worker's entry point, relative to its own app directory — the shape
 * the generated wrangler configs want under `main`. `workerMainPath` composes
 * the repo-root-relative spelling Alchemy runs under, so both emitters
 * resolve from this one record rather than spelling the path twice.
 */
export const workerEntryPoints = {
  web: 'src/server.ts',
  api: 'src/index.ts',
  background: 'src/index.ts'
} satisfies Record<WorkerApp, string>

/** `main` as Alchemy spells it: repo-root-relative. */
export function workerMainPath(app: WorkerApp): string {
  return `./apps/${app}/${workerEntryPoints[app]}`
}

export type StageResourceNames = {
  readonly stage: string
  readonly database: string
  readonly webhookQueue: string
  readonly webhookDeadLetterQueue: string
  /** The seat-sync queue (ADR 0060). */
  readonly billingQueue: string
  readonly workspaceExportQueue: string
  readonly workspaceExportBucket: string
  readonly notificationEmailQueue: string
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
      billingQueue: billingQueueName,
      workspaceExportQueue: workspaceExportQueueName,
      workspaceExportBucket: workspaceExportBucketName,
      notificationEmailQueue: notificationEmailQueueName,
      worker: (app) => `b2b-saas-starter-${app}`
    }
  }
  const prefix = `b2b-saas-starter-${stage}`
  return {
    stage,
    database: prefix,
    webhookQueue: `${prefix}-webhooks`,
    webhookDeadLetterQueue: `${prefix}-webhooks-dlq`,
    billingQueue: `${prefix}-billing`,
    workspaceExportQueue: `${prefix}-workspace-exports`,
    workspaceExportBucket: `${prefix}-workspace-exports`,
    notificationEmailQueue: `${prefix}-notification-emails`,
    worker: (app) => `${prefix}-${app}`
  }
}

/**
 * The `workers.dev` URL a Worker serves at when it has no custom domain:
 * `https://<worker>.<account subdomain>.workers.dev`. The preview workflow and
 * `alchemy.run.ts` derive `BETTER_AUTH_URL` and the deployment status URL from
 * this, so the two can never disagree about where a preview lives.
 */
export function workersDevUrl(workerName: string, subdomain: string): string {
  return `https://${workerName}.${subdomain}.workers.dev`
}

// Workspace data export (ADR 0055). One queue carries export jobs from the
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

// Instant notification emails: small batches so one slow send does not hold a
// large batch. The consumer always retries with its own `backoffSeconds(attempts)`
// delay (`consumeBatch`), so no queue-level `retryDelay` is set — the consumer's
// ladder, not a platform default, schedules every redelivery.
export const notificationEmailConsumerSettings: QueueConsumerSettings = {
  batchSize: 10,
  maxConcurrency: 2,
  maxRetries: 3,
  maxWaitTimeMs: 5000
}
