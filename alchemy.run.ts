import * as Alchemy from 'alchemy'
import * as Cloudflare from 'alchemy/Cloudflare'
import * as Effect from 'effect/Effect'
import * as Redacted from 'effect/Redacted'
import {
  apiRateLimits,
  bookingEventsConsumerSettings,
  bookingEventsQueueName,
  bookingRateLimits,
  merchantRateLimits,
  type RateLimitBindingSpec
} from './infra/bindings.ts'
import { bookingProductWorkers } from './infra/topology.ts'
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

function requiredHostname(name: string): string {
  const value = requiredEnv(name)
  try {
    const hostname = new URL(value).hostname
    if (!hostname) throw new Error('origin has no hostname')
    return hostname
  } catch {
    throw new Error(`Expected ${name} to be a valid origin URL`)
  }
}

function optionalSecret(name: string) {
  const value = process.env[name]
  return value ? Redacted.make(value) : undefined
}

const MERCHANT_AUTH_SECRET = Redacted.make(requiredEnv('MERCHANT_AUTH_SECRET'))
const CONFIRMATION_SIGNING_KEYS = Redacted.make(
  requiredEnv('CONFIRMATION_SIGNING_KEYS')
)
const CONFIRMATION_CURRENT_KEY_ID = requiredEnv('CONFIRMATION_CURRENT_KEY_ID')
const merchantAppOrigin = requiredEnv('MERCHANT_APP_ORIGIN')
const publicSiteOrigin = requiredEnv('PUBLIC_SITE_ORIGIN')
const publicSiteDomain = requiredHostname('PUBLIC_SITE_ORIGIN')
const merchantAppDomain = requiredHostname('MERCHANT_APP_ORIGIN')
const platformApiDomain = requiredHostname('PLATFORM_API_ORIGIN')
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

    const bookingEventsQueue = yield* Cloudflare.Queue('booking-events-queue', {
      name: bookingEventsQueueName
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
      name: bookingProductWorkers.api.name,
      url: false,
      domain: platformApiDomain,
      main: './apps/api/src/index.ts',
      bindings: {
        DB: db,
        ...(transactionalEmail ? { EMAIL: transactionalEmail } : {})
      },
      env: optionalModuleEnv,
      compatibility: { date: '2026-05-16' },
      observability,
      placement: smartPlacement
    })

    yield* attachWorkersAi(api)

    yield* attachRateLimits(api, apiRateLimits)

    const merchant = yield* Cloudflare.Vite('merchant', {
      name: bookingProductWorkers.merchant.name,
      url: false,
      domain: merchantAppDomain,
      rootDir: './apps/merchant',
      bindings: {
        DB: db,
        ...(transactionalEmail ? { EMAIL: transactionalEmail } : {})
      },
      env: {
        ...optionalModuleEnv,
        MERCHANT_AUTH_SECRET,
        MERCHANT_AUTH_URL: merchantAppOrigin,
        MERCHANT_AUTH_TRUSTED_ORIGINS: merchantAppOrigin
      },
      compatibility: {
        flags: ['nodejs_compat']
      },
      observability
    })

    yield* attachRateLimits(merchant, merchantRateLimits)

    const booking = yield* Cloudflare.Vite('booking', {
      name: bookingProductWorkers.booking.name,
      // Customer traffic reaches this worker only through `web`'s BOOKING
      // service binding. Its direct local Vite server is development-only.
      url: false,
      rootDir: './apps/booking',
      bindings: {
        DB: db,
        BOOKING_EVENTS_QUEUE: bookingEventsQueue,
        CONFIRMATION_SIGNING_KEYS,
        CONFIRMATION_CURRENT_KEY_ID
      },
      env: { ...optionalModuleEnv, PUBLIC_SITE_ORIGIN: publicSiteOrigin },
      compatibility: {
        flags: ['nodejs_compat']
      },
      observability
    })

    yield* attachRateLimits(booking, bookingRateLimits)

    const background = yield* Cloudflare.Worker('background', {
      name: bookingProductWorkers.background.name,
      url: false,
      main: './apps/background/src/index.ts',
      bindings: {
        DB: db,
        BOOKING_EVENTS_QUEUE: bookingEventsQueue,
        CONFIRMATION_SIGNING_KEYS,
        CONFIRMATION_CURRENT_KEY_ID,
        ...(transactionalEmail ? { EMAIL: transactionalEmail } : {})
      },
      env: { ...optionalModuleEnv, PUBLIC_SITE_ORIGIN: publicSiteOrigin },
      crons: ['*/5 * * * *'],
      compatibility: { date: '2026-05-16' },
      observability,
      placement: smartPlacement
    })

    yield* Cloudflare.QueueConsumer('booking-events-consumer', {
      queueId: bookingEventsQueue.queueId,
      scriptName: background.workerName,
      settings: bookingEventsConsumerSettings
    })

    const web = yield* Cloudflare.Vite('web', {
      name: bookingProductWorkers.web.name,
      url: false,
      domain: publicSiteDomain,
      rootDir: './apps/web',
      bindings: {
        DB: db,
        BOOKING: booking,
        ...(transactionalEmail ? { EMAIL: transactionalEmail } : {})
      },
      // Merchant credentials belong only to the Merchant App. The Public
      // Site no longer receives a Better Auth secret or session binding.
      env: optionalModuleEnv,
      compatibility: {
        flags: ['nodejs_compat']
      },
      observability
    })

    return {
      api,
      background,
      booking,
      bookingEventsQueue,
      db,
      merchant,
      transactionalEmail,
      web
    }
  })
)

export default Stack
