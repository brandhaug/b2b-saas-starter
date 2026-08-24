import * as Alchemy from 'alchemy'
import * as Cloudflare from 'alchemy/Cloudflare'
import * as Effect from 'effect/Effect'
import * as Redacted from 'effect/Redacted'
import {
  apiRateLimits,
  webhookConsumerSettings,
  webhookDeadLetterQueueName,
  webhookDlqConsumerSettings,
  webhookQueueName,
  webRateLimits,
  type RateLimitBindingSpec
} from './infra/bindings.ts'
import {
  optionalModuleEnvPlainKeys,
  optionalModuleEnvSecretKeys
} from './packages/env/src/server.ts'

type BindableWorker = {
  readonly bind: (
    template: TemplateStringsArray,
    ...args: unknown[]
  ) => (data: unknown) => Effect.Effect<void>
}

/**
 * The EMAIL binding, spread into every worker. Built as its own object so the
 * key is absent — not `undefined` — when the transactional email resource was
 * not provisioned, since a worker with `EMAIL: undefined` is a different
 * deployment shape than a worker with no EMAIL binding at all.
 */
type OptionalEmailBinding = { EMAIL?: Cloudflare.SendEmail }

function attachRateLimits(
  worker: BindableWorker,
  specs: readonly RateLimitBindingSpec[]
) {
  return Effect.all(
    specs.map((spec) =>
      worker.bind`${spec.name}`({
        bindings: [
          {
            name: spec.name,
            type: 'ratelimit',
            namespaceId: spec.namespaceId,
            simple: { limit: spec.limit, period: spec.period }
          }
        ]
      })
    )
  )
}

function attachWorkersAi(worker: BindableWorker) {
  return worker.bind`AI`({
    bindings: [{ name: 'AI', type: 'ai' }]
  })
}

// Single `process.env` reader for the whole deploy entrypoint. This file runs
// on Bun at deploy time (CI or a developer machine), not inside a Worker, and
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
  if (!value) return
  return Redacted.make(value)
}

const BETTER_AUTH_SECRET = Redacted.make(requiredEnv('BETTER_AUTH_SECRET'))
const BETTER_AUTH_URL = requiredEnv('BETTER_AUTH_URL')
const BETTER_AUTH_TRUSTED_ORIGINS =
  readEnv('BETTER_AUTH_TRUSTED_ORIGINS') ?? BETTER_AUTH_URL
// Optional: when unset, the SendEmail binding is skipped and the email
// module degrades to inactive (see ARCHITECTURE.md secret matrix). Workers
// read the same `CLOUDFLARE_EMAIL_FROM` name via `optionalProviderEnv` below —
// there is no second email var name.
const CLOUDFLARE_EMAIL_FROM = readEnv('CLOUDFLARE_EMAIL_FROM')

// Optional provider env, forwarded to the web, API, and background workers so
// a deployed worker receives its provider configuration. Unset values leave
// the relevant provider inactive instead of failing the deploy. The key lists(and
// the secret-vs-plain split) live in `packages/env/src/server.ts` next to the
// schema — adding a var there is the ONE place to edit.
const optionalProviderEnv = {
  ...Object.fromEntries(
    optionalModuleEnvSecretKeys.map((key) => [key, optionalSecret(key)])
  ),
  ...Object.fromEntries(
    optionalModuleEnvPlainKeys.map((key) => [key, readEnv(key) ?? null])
  )
}

const observability: Cloudflare.WorkerObservability = {
  enabled: true,
  logs: { enabled: true, invocationLogs: true }
}

const smartPlacement: Cloudflare.WorkerPlacement = { mode: 'smart' }

export const Stack = Alchemy.Stack(
  'b2b-saas-starter',
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state()
  },
  Effect.gen(function* () {
    const db = yield* Cloudflare.D1Database('b2b-saas-starter-db', {
      name: 'b2b-saas-starter',
      migrationsDir: './packages/db/migrations'
    })

    const webhookDeadLetterQueue = yield* Cloudflare.Queue('webhook-queue-dlq', {
      name: webhookDeadLetterQueueName
    })

    const webhookQueue = yield* Cloudflare.Queue('webhook-queue', {
      name: webhookQueueName
    })

    // Only provision the SendEmail binding when a verified sender is
    // configured — without it the email module stays inactive instead of
    // failing the deploy.
    let transactionalEmail: Cloudflare.SendEmail | undefined
    if (CLOUDFLARE_EMAIL_FROM) {
      transactionalEmail = yield* Cloudflare.SendEmail('EMAIL', {
        // Restrict the Worker to sending from the verified default. Add
        // more `allowedSenderAddresses` here as you verify additional
        // domains in Cloudflare Email Routing.
        allowedSenderAddresses: [CLOUDFLARE_EMAIL_FROM]
      })
    }

    // Built as its own object so every worker below spreads the same optional
    // binding set: the EMAIL key exists only when the resource does.
    const emailBinding: OptionalEmailBinding = {}
    if (transactionalEmail) emailBinding.EMAIL = transactionalEmail

    const api = yield* Cloudflare.Worker('api', {
      name: 'b2b-saas-starter-api',
      main: './apps/api/src/index.ts',
      bindings: {
        DB: db,
        // Producer only — the background worker consumes; the API worker
        // enqueues webhook events after audit-worthy mutations.
        WEBHOOK_QUEUE: webhookQueue,
        ...emailBinding
      },
      env: optionalProviderEnv,
      compatibility: { date: '2026-05-16', flags: ['nodejs_compat'] },
      observability,
      placement: smartPlacement
    })

    yield* attachWorkersAi(api)

    yield* attachRateLimits(api, apiRateLimits)

    const background = yield* Cloudflare.Worker('background', {
      name: 'b2b-saas-starter-background',
      main: './apps/background/src/index.ts',
      bindings: {
        DB: db,
        WEBHOOK_QUEUE: webhookQueue,
        ...emailBinding
      },
      env: optionalProviderEnv,
      compatibility: { date: '2026-05-16', flags: ['nodejs_compat'] },
      observability,
      placement: smartPlacement
    })

    yield* Cloudflare.QueueConsumer('webhook-consumer', {
      queueId: webhookQueue.queueId,
      scriptName: background.workerName,
      deadLetterQueue: webhookDeadLetterQueue.queueName,
      settings: webhookConsumerSettings
    })

    // Dead-letter consumer: the background worker records terminal
    // `dead_lettered` delivery rows for messages that exhausted maxRetries.
    yield* Cloudflare.QueueConsumer('webhook-dlq-consumer', {
      queueId: webhookDeadLetterQueue.queueId,
      scriptName: background.workerName,
      settings: webhookDlqConsumerSettings
    })

    const web = yield* Cloudflare.Vite('web', {
      name: 'b2b-saas-starter-web',
      rootDir: './apps/web',
      bindings: {
        DB: db,
        ...emailBinding
      },
      env: {
        ...optionalProviderEnv,
        BETTER_AUTH_SECRET,
        BETTER_AUTH_URL,
        BETTER_AUTH_TRUSTED_ORIGINS
      },
      compatibility: {
        flags: ['nodejs_compat']
      },
      observability
    })

    yield* attachRateLimits(web, webRateLimits)

    yield* attachWorkersAi(web)

    return {
      api,
      background,
      db,
      transactionalEmail,
      web,
      webhookQueue,
      webhookDeadLetterQueue
    }
  })
)

export default Stack
