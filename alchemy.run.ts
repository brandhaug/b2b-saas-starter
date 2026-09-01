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

/**
 * The EMAIL binding, spread into every worker. Built as its own object so the
 * key is absent — not `undefined` — when the transactional email resource was
 * not provisioned, since a worker with `EMAIL: undefined` is a different
 * deployment shape than a worker with no EMAIL binding at all.
 */
type OptionalEmailBinding = { EMAIL?: Cloudflare.Email.SendEmail }

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
  if (!value) {
    return
  }
  return Redacted.make(value)
}

// Set secrets only. An unset optional secret contributes no binding at all,
// so the module reports needs-config instead of failing the deploy.
function presentSecretEntries(
  names: ReadonlyArray<string>
): Array<[string, Redacted.Redacted<string>]> {
  const entries: Array<[string, Redacted.Redacted<string>]> = []
  for (const name of names) {
    const secret = optionalSecret(name)
    if (secret) {
      entries.push([name, secret])
    }
  }
  return entries
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
// a deployed worker receives its provider configuration. Unset values are
// omitted entirely — a worker env key that is present but `null` leaks into
// every consumer (e.g. the telemetry config's string guards) and violates
// the provider-light rule, which treats an absent key as inactive. The key
// lists (and the secret-vs-plain split) live in `packages/env/src/server.ts`
// next to the schema — adding a var there is the ONE place to edit.
const optionalProviderEnv = {
  ...Object.fromEntries(presentSecretEntries(optionalModuleEnvSecretKeys)),
  ...Object.fromEntries(
    optionalModuleEnvPlainKeys.flatMap((key) => {
      const value = readEnv(key)
      return value !== undefined && value !== '' ? [[key, value]] : []
    })
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
    const db = yield* Cloudflare.D1.Database('b2b-saas-starter-db', {
      name: 'b2b-saas-starter',
      migrationsDir: './packages/db/migrations'
    })

    const webhookDeadLetterQueue = yield* Cloudflare.Queues.Queue('webhook-queue-dlq', {
      name: webhookDeadLetterQueueName
    })

    const webhookQueue = yield* Cloudflare.Queues.Queue('webhook-queue', {
      name: webhookQueueName
    })

    // Only provision the SendEmail binding when a verified sender is
    // configured — without it the email module stays inactive instead of
    // failing the deploy.
    let transactionalEmail: Cloudflare.Email.SendEmail | undefined
    if (CLOUDFLARE_EMAIL_FROM) {
      transactionalEmail = yield* Cloudflare.Email.SendEmail('EMAIL', {
        // Restrict the Worker to sending from the verified default. Add
        // more `allowedSenderAddresses` here as you verify additional
        // domains in Cloudflare Email Routing.
        allowedSenderAddresses: [CLOUDFLARE_EMAIL_FROM]
      })
    }

    // Built as its own object so every worker below spreads the same optional
    // binding set: the EMAIL key exists only when the resource does.
    const emailBinding: OptionalEmailBinding = {}
    if (transactionalEmail) {
      emailBinding.EMAIL = transactionalEmail
    }

    const api = yield* Cloudflare.Worker('api', {
      name: 'b2b-saas-starter-api',
      main: './apps/api/src/index.ts',
      env: {
        DB: db,
        // Producer only — the background worker consumes; the API worker
        // enqueues webhook events after audit-worthy mutations.
        WEBHOOK_QUEUE: webhookQueue,
        AI: Cloudflare.Workers.AI('AI'),
        ...rateLimitBindings(apiRateLimits),
        ...emailBinding,
        ...optionalProviderEnv
      },
      compatibility: { date: '2026-05-16', flags: ['nodejs_compat'] },
      observability,
      placement: smartPlacement
    })

    const background = yield* Cloudflare.Worker('background', {
      name: 'b2b-saas-starter-background',
      main: './apps/background/src/index.ts',
      env: {
        DB: db,
        WEBHOOK_QUEUE: webhookQueue,
        ...emailBinding,
        ...optionalProviderEnv
      },
      compatibility: { date: '2026-05-16', flags: ['nodejs_compat'] },
      observability,
      placement: smartPlacement
    })

    yield* Cloudflare.Queues.Consumer('webhook-consumer', {
      queueId: webhookQueue.queueId,
      scriptName: background.workerName,
      deadLetterQueue: webhookDeadLetterQueue.queueName,
      settings: webhookConsumerSettings
    })

    // Dead-letter consumer: the background worker records terminal
    // `dead_lettered` delivery rows for messages that exhausted maxRetries.
    yield* Cloudflare.Queues.Consumer('webhook-dlq-consumer', {
      queueId: webhookDeadLetterQueue.queueId,
      scriptName: background.workerName,
      settings: webhookDlqConsumerSettings
    })

    const web = yield* Cloudflare.Website.Vite('web', {
      name: 'b2b-saas-starter-web',
      rootDir: './apps/web',
      env: {
        DB: db,
        ...rateLimitBindings(webRateLimits),
        AI: Cloudflare.Workers.AI('AI'),
        ...emailBinding,
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
