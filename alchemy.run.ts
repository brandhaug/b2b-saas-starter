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
  workerCompatibility,
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
    const db = yield* Cloudflare.D1.Database('b2b-saas-starter-db', {
      name: 'b2b-saas-starter',
      // Alchemy 2.0 takes the migrations input as `migrations` ({ dir, table? });
      // a `migrationsDir` prop is silently dropped and the database deploys with
      // no schema applied.
      migrations: { dir: './packages/db/migrations' }
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

    // One AI binding shared by the two workers that expose the assistant —
    // constructing it twice declares the same binding under two identities.
    const ai = Cloudflare.Workers.AI('AI')

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
        AI: ai,
        ...rateLimitBindings(apiRateLimits),
        ...emailBinding,
        ...optionalProviderEnv
      },
      ...workerDefaults,
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
      ...workerDefaults,
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
        AI: ai,
        ...emailBinding,
        ...optionalProviderEnv,
        BETTER_AUTH_SECRET,
        BETTER_AUTH_URL,
        BETTER_AUTH_TRUSTED_ORIGINS
      },
      ...workerDefaults
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
