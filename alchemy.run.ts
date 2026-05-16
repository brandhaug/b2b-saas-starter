import * as Alchemy from 'alchemy'
import * as Cloudflare from 'alchemy/Cloudflare'
import * as Effect from 'effect/Effect'
import * as Redacted from 'effect/Redacted'

type RateLimitBindingSpec = {
  readonly name: string
  readonly namespaceId: string
  readonly limit: number
  readonly period: 10 | 60
}

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
const EMAIL_FROM_ADDRESS = requiredEnv('CLOUDFLARE_EMAIL_FROM')

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
      name: 'b2b-saas-starter-webhooks-dlq'
    })

    const webhookQueue = yield* Cloudflare.Queue('webhook-queue', {
      name: 'b2b-saas-starter-webhooks'
    })

    const transactionalEmail = yield* Cloudflare.SendEmail('EMAIL', {
      // Restrict the Worker to sending from the verified default. Add
      // more `allowedSenderAddresses` here as you verify additional
      // domains in Cloudflare Email Routing.
      allowedSenderAddresses: [EMAIL_FROM_ADDRESS]
    })

    const api = yield* Cloudflare.Worker('api', {
      name: 'b2b-saas-starter-api',
      main: './apps/api/src/index.ts',
      bindings: { DB: db, EMAIL: transactionalEmail },
      env: {
        EMAIL_FROM_ADDRESS,
        WORKERS_AI_ENABLED: process.env.WORKERS_AI_ENABLED ?? 'false',
        OPENAI_API_KEY: optionalSecret('OPENAI_API_KEY'),
        OPENAI_BASE_URL: process.env.OPENAI_BASE_URL ?? null,
        OPENAI_MODEL_ID: process.env.OPENAI_MODEL_ID ?? null
      },
      compatibility: { date: '2026-05-16' },
      observability,
      placement: smartPlacement
    })

    yield* attachWorkersAi(api)

    yield* attachRateLimits(api, [
      { name: 'RATE_LIMITER_REST', namespaceId: '1001', limit: 60, period: 60 },
      { name: 'RATE_LIMITER_REST_WRITE', namespaceId: '1002', limit: 20, period: 60 },
      { name: 'RATE_LIMITER_INVITATIONS', namespaceId: '1003', limit: 10, period: 60 },
      { name: 'RATE_LIMITER_ASSISTANT', namespaceId: '1004', limit: 20, period: 60 },
      { name: 'RATE_LIMITER_MCP', namespaceId: '1005', limit: 30, period: 60 }
    ])

    const background = yield* Cloudflare.Worker('background', {
      name: 'b2b-saas-starter-background',
      main: './apps/background/src/index.ts',
      bindings: { DB: db, WEBHOOK_QUEUE: webhookQueue, EMAIL: transactionalEmail },
      compatibility: { date: '2026-05-16' },
      observability,
      placement: smartPlacement
    })

    yield* Cloudflare.QueueConsumer('webhook-consumer', {
      queueId: webhookQueue.queueId,
      scriptName: background.workerName,
      deadLetterQueue: webhookDeadLetterQueue.queueName,
      settings: {
        batchSize: 25,
        maxConcurrency: 4,
        maxRetries: 6,
        maxWaitTimeMs: 5_000,
        retryDelay: 30
      }
    })

    const web = yield* Cloudflare.Vite('web', {
      name: 'b2b-saas-starter-web',
      rootDir: './apps/web',
      bindings: { DB: db, EMAIL: transactionalEmail },
      env: {
        BETTER_AUTH_SECRET,
        BETTER_AUTH_URL,
        BETTER_AUTH_TRUSTED_ORIGINS,
        GITHUB_CLIENT_ID: optionalSecret('GITHUB_CLIENT_ID'),
        GITHUB_CLIENT_SECRET: optionalSecret('GITHUB_CLIENT_SECRET')
      },
      compatibility: {
        flags: ['nodejs_compat']
      },
      observability
    })

    yield* attachRateLimits(web, [
      { name: 'RATE_LIMITER_AUTH_READ', namespaceId: '2001', limit: 60, period: 60 },
      { name: 'RATE_LIMITER_AUTH_WRITE', namespaceId: '2002', limit: 20, period: 60 }
    ])

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
