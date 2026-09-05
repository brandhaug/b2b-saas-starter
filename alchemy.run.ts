import * as Alchemy from 'alchemy'
import * as Cloudflare from 'alchemy/Cloudflare'
import * as Effect from 'effect/Effect'
import * as Redacted from 'effect/Redacted'
import {
  apiRateLimits,
  billingConsumerSettings,
  isPreviewStage,
  notificationDigestCron,
  notificationEmailConsumerSettings,
  productionStage,
  queueBindingKeys,
  stageResourceNames,
  webhookConsumerSettings,
  webhookDlqConsumerSettings,
  webRateLimits,
  workerCompatibility,
  workerMainPath,
  workersDevUrl,
  WORKSPACE_EXPORT_RETENTION_DAYS,
  workspaceExportConsumerSettings,
  type RateLimitBindingSpec
} from './infra/bindings.ts'
import {
  optionalModuleEnvPlainKeys,
  optionalModuleEnvSecretKeys
} from './packages/env/src/server.ts'

/**
 * The EMAIL binding, spread into every worker. Built as its own object so the
 * key is absent — not `undefined` — when the transactional email resource was
 * not provisioned, since a worker with `EMAIL: undefined` is a different
 * deployment shape than a worker with no EMAIL binding at all.
 */
type OptionalEmailBinding = { EMAIL?: Cloudflare.Email.SendEmail }

/**
 * The workspace export bindings (ADR 0055), spread into every worker on the
 * same terms as EMAIL: both keys are absent — not `undefined` — when
 * `WORKSPACE_EXPORT_BUCKET` was not set, and the capability then reports
 * unavailable instead of failing a request.
 */
type OptionalWorkspaceExportBindings = {
  WORKSPACE_EXPORT_QUEUE?: Cloudflare.Queues.Queue
  WORKSPACE_EXPORT_BUCKET?: Cloudflare.R2.Bucket
}

// Rate limits are Worker-only bindings with no backing cloud resource, so
// they are declared inline on the Worker's `env` rather than provisioned as
// their own resources. The `env` key is the binding name the Worker reads.
function rateLimitBindings(specs: ReadonlyArray<RateLimitBindingSpec>) {
  return Object.fromEntries(
    specs.map((spec) => [
      spec.name,
      Cloudflare.Workers.RateLimit(spec.name, {
        namespaceId: spec.namespaceId,
        simple: { limit: spec.limit, period: spec.period }
      })
    ])
  )
}

// Single `process.env` reader for the whole deploy entrypoint. This file runs
// on Node at deploy time (CI or a developer machine), not inside a Worker, and
// the values below are read at module scope where no Effect runtime — and so
// no `Config`/`ConfigProvider` — exists yet. Every other env read in this file
// goes through here so the platform-global escape hatch has exactly one site.
function readEnv(name: string): string | undefined {
  return process.env[name]
}

function requiredEnv(name: string): string {
  const value = readEnv(name)
  if (!value) {
    throw new Error(`Missing required deploy environment variable: ${name}`)
  }
  return value
}

function optionalSecret(name: string): Redacted.Redacted<string> | undefined {
  const value = readEnv(name)
  if (!value) {
    return
  }
  return Redacted.make(value)
}

/**
 * The one "entries for the env vars that are actually set" helper. An unset
 * optional var contributes no binding at all, so the module reports
 * needs-config instead of failing the deploy. `read` decides how a present
 * value is carried — as a redacted secret, or as a plain string.
 */
function presentEntries<A>(
  names: ReadonlyArray<string>,
  read: (name: string) => A | undefined
): Array<[string, A]> {
  const entries: Array<[string, A]> = []
  for (const name of names) {
    const value = read(name)
    if (value !== undefined) {
      entries.push([name, value])
    }
  }
  return entries
}

// The stage comes from the Alchemy CLI (`--stage pr-42`, or `$STAGE`; the
// `deploy:stage`/`destroy:stage` scripts pass `$ALCHEMY_STAGE` through as the
// flag). It is read inside the Stack below via the `Stage` service, so the
// module scope only resolves the values that do not depend on it.
const BETTER_AUTH_SECRET = Redacted.make(requiredEnv('BETTER_AUTH_SECRET'))
// Preview stages (ADR 0054) can derive their URL from the account's
// `workers.dev` subdomain instead of requiring a per-PR `BETTER_AUTH_URL`.
const CLOUDFLARE_WORKERS_SUBDOMAIN = readEnv('CLOUDFLARE_WORKERS_SUBDOMAIN')

function resolveBetterAuthUrl(stage: string, webWorkerName: string): string {
  const explicit = readEnv('BETTER_AUTH_URL')
  if (explicit) {
    return explicit
  }
  if (isPreviewStage(stage) && CLOUDFLARE_WORKERS_SUBDOMAIN) {
    return workersDevUrl(webWorkerName, CLOUDFLARE_WORKERS_SUBDOMAIN)
  }
  return requiredEnv('BETTER_AUTH_URL')
}
// Optional: when unset, the SendEmail binding is skipped and the email
// module degrades to inactive (see ARCHITECTURE.md secret matrix). Workers
// read the same `CLOUDFLARE_EMAIL_FROM` name via `optionalProviderEnv` below —
// there is no second email var name.
const CLOUDFLARE_EMAIL_FROM = readEnv('CLOUDFLARE_EMAIL_FROM')
// Optional: when unset, no export bucket or queue is provisioned and the
// `WorkspaceExports` capability reports unavailable (ADR 0055). The value is
// the bucket name; `infra/bindings.ts` carries the local-dev default.
const WORKSPACE_EXPORT_BUCKET = readEnv('WORKSPACE_EXPORT_BUCKET')

// Optional provider env, forwarded to the web, API, and background workers so
// a deployed worker receives its provider configuration. Unset values are
// omitted entirely — a worker env key that is present but `null` leaks into
// every consumer (e.g. the telemetry config's string guards, and
// packages/env's module-scope audit, which 500ed every route on `null.length`
// in the first green deploy) and violates the provider-light rule, which
// treats an absent key as inactive. The key lists (and the secret-vs-plain
// split) live in `packages/env/src/server.ts` next to the schema — adding a
// var there is the ONE place to edit.
const optionalProviderEnv = {
  ...Object.fromEntries(presentEntries(optionalModuleEnvSecretKeys, optionalSecret)),
  ...Object.fromEntries(
    presentEntries(optionalModuleEnvPlainKeys, (key) => readEnv(key) || undefined)
  )
}

// Preview stages carry only the deploy identity. Every env-gated provider
// (Turnstile, Stripe, Sentry, PostHog, OTLP, OpenAI, Workers AI, email) stays
// unset on a `pr-<number>` stage even when the deploying shell has the values,
// so a preview can never charge a card, page an on-call, or send real mail.
// `ENVIRONMENT` defaults to `preview` so the required-env gate runs in its
// deployed (warn-only) mode rather than treating the Worker as local dev.
const previewPlainKeys: ReadonlySet<string> = new Set([
  'ENVIRONMENT',
  'SERVICE_VERSION',
  'GIT_COMMIT_SHA'
])

function providerEnvForStage(stage: string) {
  if (!isPreviewStage(stage)) {
    if (stage !== productionStage) {
      return optionalProviderEnv
    }
    // The prod stage defaults to `ENVIRONMENT=production`: the documented
    // deploy path may not carry ENVIRONMENT at all, and unset it reads as
    // local dev inside the worker — silently disarming both
    // `requireEmailVerification` and the production env gate. An explicit
    // value in the deploying shell still wins (spread order), mirroring the
    // preview default below.
    return { ENVIRONMENT: 'production', ...optionalProviderEnv }
  }
  const kept = Object.fromEntries(
    Object.entries(optionalProviderEnv).filter(([key]) => previewPlainKeys.has(key))
  )
  return { ENVIRONMENT: 'preview', ...kept }
}

function emailFromForStage(stage: string): string | undefined {
  if (isPreviewStage(stage)) {
    return
  }
  return CLOUDFLARE_EMAIL_FROM
}

const observability: Cloudflare.WorkerObservability = {
  enabled: true,
  logs: { enabled: true, invocationLogs: true }
}

// Smart placement moves a worker near its data. It belongs to the worker-only
// services; the web worker serves the document and stays near the eyeball.
const smartPlacement: Cloudflare.WorkerPlacement = { mode: 'smart' }

// One worker shape shared by all three workers: the compatibility date comes
// from `infra/bindings.ts`, the same constant `infra/write-wrangler.ts`
// generates each wrangler.jsonc from, so production can never run a different
// runtime behavior than local dev — a date that silently dropped off the web
// worker once already (it defaulted to Alchemy's fallback while wrangler dev
// pinned one).
const workerDefaults = {
  compatibility: {
    date: workerCompatibility.date,
    flags: [...workerCompatibility.flags]
  },
  observability
}

export const Stack = Alchemy.Stack(
  'b2b-saas-starter',
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state()
  },
  Effect.gen(function* () {
    // `prod` keeps the historical names; any other stage gets its own D1,
    // queues, and Workers under `b2b-saas-starter-<stage>-…` (infra/bindings.ts).
    const stage = yield* Alchemy.Stage
    const names = stageResourceNames(stage)
    const providerEnv = providerEnvForStage(stage)
    const emailFrom = emailFromForStage(stage)
    const BETTER_AUTH_URL = resolveBetterAuthUrl(stage, names.worker('web'))
    const BETTER_AUTH_TRUSTED_ORIGINS =
      readEnv('BETTER_AUTH_TRUSTED_ORIGINS') ?? BETTER_AUTH_URL

    const db = yield* Cloudflare.D1.Database('b2b-saas-starter-db', {
      name: names.database,
      // Alchemy 2.0 takes the migrations input as `migrations` ({ dir, table? });
      // a `migrationsDir` prop is silently dropped and the database deploys with
      // no schema applied.
      migrations: { dir: './packages/db/migrations' }
    })

    const webhookDeadLetterQueue = yield* Cloudflare.Queues.Queue('webhook-queue-dlq', {
      name: names.webhookDeadLetterQueue
    })

    const webhookQueue = yield* Cloudflare.Queues.Queue('webhook-queue', {
      name: names.webhookQueue
    })

    // Seat sync: membership and invitation mutations enqueue; the background
    // worker consumes and reconciles the Stripe subscription item quantity.
    const billingQueue = yield* Cloudflare.Queues.Queue('billing-queue', {
      name: names.billingQueue
    })
    // Instant notification emails (ADR 0061). Produced by every worker that
    // creates a Notification, consumed by the background worker.
    const notificationEmailQueue = yield* Cloudflare.Queues.Queue(
      'notification-email-queue',
      { name: names.notificationEmailQueue }
    )

    // Only provision the SendEmail binding when a verified sender is
    // configured — without it the email module stays inactive instead of
    // failing the deploy.
    let transactionalEmail: Cloudflare.Email.SendEmail | undefined
    if (emailFrom) {
      transactionalEmail = yield* Cloudflare.Email.SendEmail('EMAIL', {
        // Restrict the Worker to sending from the verified default. Add
        // more `allowedSenderAddresses` here as you verify additional
        // domains in Cloudflare Email Routing.
        allowedSenderAddresses: [emailFrom]
      })
    }

    // One AI binding shared by the two workers that expose the assistant —
    // constructing it twice declares the same binding under two identities.
    const ai = Cloudflare.Workers.AI('AI')

    // Built as its own object so every worker below spreads the same optional
    // binding set: the EMAIL key exists only when the resource does.
    const emailBinding: OptionalEmailBinding = {}
    if (transactionalEmail) {
      emailBinding.EMAIL = transactionalEmail
    }

    // Workspace export (ADR 0055): one queue for the jobs, one R2 bucket for
    // the archives, both only when an operator named the bucket. The lifecycle
    // rule deletes every artifact after the retention window — the same
    // horizon `WorkspaceExports` stamps onto `expiresAt`.
    const workspaceExportBindings: OptionalWorkspaceExportBindings = {}
    let workspaceExportQueue: Cloudflare.Queues.Queue | undefined
    if (WORKSPACE_EXPORT_BUCKET) {
      const bucket = yield* Cloudflare.R2.Bucket('workspace-export-bucket', {
        name: WORKSPACE_EXPORT_BUCKET || names.workspaceExportBucket,
        // Every object is a disposable, re-creatable export — safe to empty on destroy.
        forceDestroy: true,
        lifecycleRules: [
          {
            id: 'expire-exports',
            deleteObjectsTransition: {
              condition: {
                type: 'Age',
                maxAge: WORKSPACE_EXPORT_RETENTION_DAYS * 24 * 60 * 60
              }
            },
            abortMultipartUploadsTransition: {
              condition: { type: 'Age', maxAge: 24 * 60 * 60 }
            }
          }
        ]
      })
      workspaceExportQueue = yield* Cloudflare.Queues.Queue('workspace-export-queue', {
        name: names.workspaceExportQueue
      })
      workspaceExportBindings.WORKSPACE_EXPORT_BUCKET = bucket
      workspaceExportBindings.WORKSPACE_EXPORT_QUEUE = workspaceExportQueue
    }

    const api = yield* Cloudflare.Worker('api', {
      name: names.worker('api'),
      main: workerMainPath('api'),
      env: {
        DB: db,
        // Producer only — the background worker consumes; the API worker
        // enqueues webhook events after audit-worthy mutations.
        [queueBindingKeys.webhookQueue]: webhookQueue,
        [queueBindingKeys.notificationEmailQueue]: notificationEmailQueue,
        AI: ai,
        ...rateLimitBindings(apiRateLimits),
        ...emailBinding,
        // Reads the export bucket to serve signed downloads; the queue lets
        // the REST surface request an export too.
        ...workspaceExportBindings,
        ...providerEnv
      },
      ...workerDefaults,
      placement: smartPlacement
    })

    const background = yield* Cloudflare.Worker('background', {
      name: names.worker('background'),
      main: workerMainPath('background'),
      env: {
        DB: db,
        [queueBindingKeys.webhookQueue]: webhookQueue,
        // No `BILLING_QUEUE` producer here: only the web worker enqueues
        // seat-sync messages, and nothing in this worker reads the binding —
        // the generated wrangler config agrees.
        [queueBindingKeys.notificationEmailQueue]: notificationEmailQueue,
        // Notification emails link back to the web app.
        BETTER_AUTH_URL,
        ...emailBinding,
        ...workspaceExportBindings,
        ...providerEnv
      },
      ...workerDefaults,
      placement: smartPlacement,
      // The daily notification digest (ADR 0061) — same constant the
      // generated wrangler.jsonc carries under `triggers.crons`.
      crons: [notificationDigestCron]
    })

    if (workspaceExportQueue) {
      yield* Cloudflare.Queues.Consumer('workspace-export-consumer', {
        queueId: workspaceExportQueue.queueId,
        scriptName: background.workerName,
        settings: workspaceExportConsumerSettings
      })
    }

    yield* Cloudflare.Queues.Consumer('webhook-consumer', {
      queueId: webhookQueue.queueId,
      scriptName: background.workerName,
      deadLetterQueue: webhookDeadLetterQueue.queueName,
      settings: webhookConsumerSettings
    })

    // Seat-sync consumer: the queue membership mutations enqueue onto, so the
    // Stripe quantity update happens off the request path.
    yield* Cloudflare.Queues.Consumer('billing-consumer', {
      queueId: billingQueue.queueId,
      scriptName: background.workerName,
      settings: billingConsumerSettings
    })

    // Dead-letter consumer: the background worker records terminal
    // `dead_lettered` delivery rows for messages that exhausted maxRetries.
    yield* Cloudflare.Queues.Consumer('webhook-dlq-consumer', {
      queueId: webhookDeadLetterQueue.queueId,
      scriptName: background.workerName,
      settings: webhookDlqConsumerSettings
    })

    // Instant notification emails: rendered and sent by the background worker.
    yield* Cloudflare.Queues.Consumer('notification-email-consumer', {
      queueId: notificationEmailQueue.queueId,
      scriptName: background.workerName,
      settings: notificationEmailConsumerSettings
    })

    const web = yield* Cloudflare.Website.Vite('web', {
      name: names.worker('web'),
      rootDir: './apps/web',
      env: {
        DB: db,
        // Producer only — the background worker consumes; membership and
        // invitation mutations enqueue seat-sync messages.
        [queueBindingKeys.billingQueue]: billingQueue,
        [queueBindingKeys.notificationEmailQueue]: notificationEmailQueue,
        ...rateLimitBindings(webRateLimits),
        AI: ai,
        ...emailBinding,
        // Workspace settings enqueues export jobs and reads the bucket binding
        // only to answer "are exports available here".
        ...workspaceExportBindings,
        ...providerEnv,
        BETTER_AUTH_SECRET,
        BETTER_AUTH_URL,
        BETTER_AUTH_TRUSTED_ORIGINS
      },
      ...workerDefaults
    })

    return {
      stage,
      api,
      background,
      billingQueue,
      db,
      transactionalEmail,
      web,
      webhookQueue,
      webhookDeadLetterQueue,
      notificationEmailQueue,
      workspaceExportQueue
    }
  })
)

export default Stack
