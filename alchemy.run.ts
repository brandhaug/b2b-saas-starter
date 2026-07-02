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

const attachRateLimits = (
  worker: BindableWorker,
  specs: readonly RateLimitBindingSpec[]
) =>
  Effect.all(
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

const attachWorkersAi = (worker: BindableWorker) =>
  worker.bind`AI`({
    bindings: [{ name: 'AI', type: 'ai' }]
  })

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required deploy environment variable: ${name}`)
  }
  return value
}

function optionalSecret(name: string) {
  const value = process.env[name]
  return value ? Redacted.make(value) : undefined
}

const BETTER_AUTH_SECRET = Redacted.make(requiredEnv('BETTER_AUTH_SECRET'))
const BETTER_AUTH_URL = requiredEnv('BETTER_AUTH_URL')
const BETTER_AUTH_TRUSTED_ORIGINS =
  process.env.BETTER_AUTH_TRUSTED_ORIGINS ?? BETTER_AUTH_URL
// Optional: when unset, the SendEmail binding is skipped and the email
// module degrades to inactive (see ARCHITECTURE.md secret matrix). Workers
// read the same `CLOUDFLARE_EMAIL_FROM` name via `optionalModuleEnv` below —
// there is no second email var name.
const CLOUDFLARE_EMAIL_FROM = process.env.CLOUDFLARE_EMAIL_FROM

// Optional module env, forwarded to the web, API, and background workers so
// the shared module-aware env validation (`@b2b-saas-starter/env`, ADR 0035)
// reports module status from the deployed environment. Unset values leave the
// module in needs-config instead of failing the deploy. The key lists (and
// the secret-vs-plain split) live in `packages/env/src/server.ts` next to the
// schema — adding a var there is the ONE place to edit.
const optionalModuleEnv = {
  ...Object.fromEntries(
    optionalModuleEnvSecretKeys.map((key) => [key, optionalSecret(key)])
  ),
  ...Object.fromEntries(
    optionalModuleEnvPlainKeys.map((key) => [key, process.env[key] ?? null])
  )
}

const observability = {
  enabled: true,
  logs: { enabled: true, invocationLogs: true }
} as const

const smartPlacement = { mode: 'smart' } as const

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
    const transactionalEmail = CLOUDFLARE_EMAIL_FROM
      ? yield* Cloudflare.SendEmail('EMAIL', {
          // Restrict the Worker to sending from the verified default. Add
          // more `allowedSenderAddresses` here as you verify additional
          // domains in Cloudflare Email Routing.
          allowedSenderAddresses: [CLOUDFLARE_EMAIL_FROM]
        })
      : undefined

    const api = yield* Cloudflare.Worker('api', {
      name: 'b2b-saas-starter-api',
      main: './apps/api/src/index.ts',
      bindings: {
        DB: db,
        // Producer only — the background worker consumes; the API worker
        // enqueues webhook events after audit-worthy mutations.
        WEBHOOK_QUEUE: webhookQueue,
        ...(transactionalEmail ? { EMAIL: transactionalEmail } : {})
      },
      env: optionalModuleEnv,
      compatibility: { date: '2026-05-16' },
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
        ...(transactionalEmail ? { EMAIL: transactionalEmail } : {})
      },
      env: optionalModuleEnv,
      compatibility: { date: '2026-05-16' },
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
        ...(transactionalEmail ? { EMAIL: transactionalEmail } : {})
      },
      env: {
        ...optionalModuleEnv,
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
