import * as Alchemy from 'alchemy'
import * as Cloudflare from 'alchemy/Cloudflare'
import * as Effect from 'effect/Effect'
import * as Redacted from 'effect/Redacted'
import {
  apiRateLimits,
  bookingEventsConsumerSettings,
  bookingEventsDeadLetterQueueName,
  bookingEventsQueueName,
  bookingRateLimits,
  merchantRateLimits,
  merchantImpersonationRateLimits,
  operationsRateLimitEnvironment,
  operationsRateLimits,
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

const merchantAuthSecret = requiredEnv('MERCHANT_AUTH_SECRET')
const operationsAuthSecret = requiredEnv('OPERATIONS_AUTH_SECRET')
if (merchantAuthSecret === operationsAuthSecret) {
  throw new Error('OPERATIONS_AUTH_SECRET must be distinct from MERCHANT_AUTH_SECRET')
}
const MERCHANT_AUTH_SECRET = Redacted.make(merchantAuthSecret)
const OPERATIONS_AUTH_SECRET = Redacted.make(operationsAuthSecret)
const CONFIRMATION_SIGNING_KEYS = Redacted.make(
  requiredEnv('CONFIRMATION_SIGNING_KEYS')
)
const CONFIRMATION_CURRENT_KEY_ID = requiredEnv('CONFIRMATION_CURRENT_KEY_ID')
const CUSTOMER_DIRECTORY_FINGERPRINT_KEY = Redacted.make(
  requiredEnv('CUSTOMER_DIRECTORY_FINGERPRINT_KEY')
)
const OPERATIONAL_MESSAGING_DESTINATION_ENCRYPTION_KEY = optionalSecret(
  'OPERATIONAL_MESSAGING_DESTINATION_ENCRYPTION_KEY'
)
const OPERATIONAL_MESSAGING_DESTINATION_FINGERPRINT_KEY = optionalSecret(
  'OPERATIONAL_MESSAGING_DESTINATION_FINGERPRINT_KEY'
)
const OPERATIONAL_MESSAGING_DESTINATION_KEY_VERSION =
  process.env.OPERATIONAL_MESSAGING_DESTINATION_KEY_VERSION
const META_WHATSAPP_ACCESS_TOKEN = optionalSecret('META_WHATSAPP_ACCESS_TOKEN')
const META_WHATSAPP_APP_SECRET = optionalSecret('META_WHATSAPP_APP_SECRET')
const META_WHATSAPP_WEBHOOK_VERIFY_TOKEN = optionalSecret(
  'META_WHATSAPP_WEBHOOK_VERIFY_TOKEN'
)
const META_WHATSAPP_REFERENCE_ENCRYPTION_KEY = optionalSecret(
  'META_WHATSAPP_REFERENCE_ENCRYPTION_KEY'
)
const META_WHATSAPP_REFERENCE_FINGERPRINT_KEY = optionalSecret(
  'META_WHATSAPP_REFERENCE_FINGERPRINT_KEY'
)
const SMSO_API_KEY = optionalSecret('SMSO_API_KEY')
const SMSO_CALLBACK_URL = optionalSecret('SMSO_CALLBACK_URL')
const SMSO_CALLBACK_PATH_SECRET = optionalSecret('SMSO_CALLBACK_PATH_SECRET')
const SMSO_PROVIDER_REFERENCE_ENCRYPTION_KEY = optionalSecret(
  'SMSO_PROVIDER_REFERENCE_ENCRYPTION_KEY'
)
const SMSO_PROVIDER_REFERENCE_FINGERPRINT_KEY = optionalSecret(
  'SMSO_PROVIDER_REFERENCE_FINGERPRINT_KEY'
)
const META_WHATSAPP_PROVIDER_ACCOUNT_KEY =
  process.env.META_WHATSAPP_PROVIDER_ACCOUNT_KEY ?? 'platform-meta'
const STRIPE_SECRET_KEY = optionalSecret('STRIPE_SECRET_KEY')
const STRIPE_WEBHOOK_SECRET = optionalSecret('STRIPE_WEBHOOK_SECRET')
const CUSTOMER_AUTH_SECRET = optionalSecret('CUSTOMER_AUTH_SECRET')
const CUSTOMER_GOOGLE_CLIENT_SECRET = optionalSecret('CUSTOMER_GOOGLE_CLIENT_SECRET')
const CUSTOMER_APPLE_CLIENT_SECRET = optionalSecret('CUSTOMER_APPLE_CLIENT_SECRET')
const merchantAppOrigin = requiredEnv('MERCHANT_APP_ORIGIN')
const operationsAppOrigin = requiredEnv('OPERATIONS_APP_ORIGIN')
const publicSiteOrigin = requiredEnv('PUBLIC_SITE_ORIGIN')
const publicSiteDomain = requiredHostname('PUBLIC_SITE_ORIGIN')
const merchantAppDomain = requiredHostname('MERCHANT_APP_ORIGIN')
const operationsAppDomain = requiredHostname('OPERATIONS_APP_ORIGIN')
const platformApiDomain = requiredHostname('PLATFORM_API_ORIGIN')
// Impersonation notification delivery is mandatory in production, so the combined
// deployment requires a verified sender and provisions one restricted binding.
const CLOUDFLARE_EMAIL_FROM = requiredEnv('CLOUDFLARE_EMAIL_FROM')
const OPERATIONS_SECURITY_CONTACT = requiredEnv('OPERATIONS_SECURITY_CONTACT')

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
    const bookingEventsDeadLetterQueue = yield* Cloudflare.Queue(
      'booking-events-dead-letter-queue',
      { name: bookingEventsDeadLetterQueueName }
    )

    const transactionalEmail = yield* Cloudflare.SendEmail('EMAIL', {
      // Restrict the Worker to sending from the verified default. Add
      // more `allowedSenderAddresses` here as you verify additional
      // domains in Cloudflare Email Routing.
      allowedSenderAddresses: [CLOUDFLARE_EMAIL_FROM]
    })

    const api = yield* Cloudflare.Worker('api', {
      name: bookingProductWorkers.api.name,
      url: false,
      domain: platformApiDomain,
      main: './apps/api/src/index.ts',
      bindings: {
        DB: db,
        CUSTOMER_DIRECTORY_FINGERPRINT_KEY,
        EMAIL: transactionalEmail,
        BOOKING_EVENTS_QUEUE: bookingEventsQueue,
        ...(META_WHATSAPP_APP_SECRET ? { META_WHATSAPP_APP_SECRET } : {}),
        ...(META_WHATSAPP_WEBHOOK_VERIFY_TOKEN
          ? { META_WHATSAPP_WEBHOOK_VERIFY_TOKEN }
          : {}),
        ...(META_WHATSAPP_REFERENCE_FINGERPRINT_KEY
          ? { META_WHATSAPP_REFERENCE_FINGERPRINT_KEY }
          : {}),
        ...(SMSO_CALLBACK_PATH_SECRET ? { SMSO_CALLBACK_PATH_SECRET } : {}),
        ...(SMSO_PROVIDER_REFERENCE_FINGERPRINT_KEY
          ? { SMSO_PROVIDER_REFERENCE_FINGERPRINT_KEY }
          : {})
      },
      env: {
        ...optionalModuleEnv,
        ENVIRONMENT: 'production',
        META_WHATSAPP_PROVIDER_ACCOUNT_KEY
      },
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
        EMAIL: transactionalEmail
      },
      env: {
        ...optionalModuleEnv,
        CUSTOMER_DIRECTORY_FINGERPRINT_KEY,
        MERCHANT_AUTH_SECRET,
        MERCHANT_AUTH_URL: merchantAppOrigin,
        MERCHANT_AUTH_TRUSTED_ORIGINS: merchantAppOrigin,
        OPERATIONS_APP_ORIGIN: operationsAppOrigin,
        OPERATIONS_SECURITY_CONTACT,
        OPERATIONS_RATE_LIMIT_HANDOFF_EXCHANGE:
          operationsRateLimitEnvironment.OPERATIONS_RATE_LIMIT_HANDOFF_EXCHANGE,
        OPERATIONS_RATE_LIMIT_WINDOW_SECONDS:
          operationsRateLimitEnvironment.OPERATIONS_RATE_LIMIT_WINDOW_SECONDS
      },
      compatibility: {
        flags: ['nodejs_compat']
      },
      observability
    })

    yield* attachRateLimits(merchant, merchantRateLimits)
    yield* attachRateLimits(merchant, merchantImpersonationRateLimits)

    const operations = yield* Cloudflare.Worker('operations', {
      name: bookingProductWorkers.operations.name,
      url: false,
      domain: operationsAppDomain,
      main: './apps/operations/src/index.ts',
      bindings: {
        DB: db,
        CUSTOMER_DIRECTORY_FINGERPRINT_KEY,
        EMAIL: transactionalEmail
      },
      env: {
        ...operationsRateLimitEnvironment,
        OPERATIONS_AUTH_SECRET,
        OPERATIONS_APP_ORIGIN: operationsAppOrigin,
        OPERATIONS_AUTH_TRUSTED_ORIGINS: operationsAppOrigin,
        MERCHANT_APP_ORIGIN: merchantAppOrigin,
        CLOUDFLARE_EMAIL_FROM,
        OPERATIONS_SECURITY_CONTACT,
        ENVIRONMENT: 'production'
      },
      compatibility: { date: '2026-05-16', flags: ['nodejs_compat'] },
      observability,
      placement: smartPlacement
    })

    yield* attachRateLimits(operations, operationsRateLimits)

    const booking = yield* Cloudflare.Vite('booking', {
      name: bookingProductWorkers.booking.name,
      // Customer traffic reaches this worker only through `web`'s BOOKING
      // service binding. Its direct local Vite server is development-only.
      url: false,
      rootDir: './apps/booking',
      bindings: {
        DB: db,
        BOOKING_EVENTS_QUEUE: bookingEventsQueue,
        CUSTOMER_DIRECTORY_FINGERPRINT_KEY,
        CONFIRMATION_SIGNING_KEYS,
        CONFIRMATION_CURRENT_KEY_ID,
        ...(OPERATIONAL_MESSAGING_DESTINATION_ENCRYPTION_KEY &&
        OPERATIONAL_MESSAGING_DESTINATION_FINGERPRINT_KEY
          ? {
              OPERATIONAL_MESSAGING_DESTINATION_ENCRYPTION_KEY,
              OPERATIONAL_MESSAGING_DESTINATION_FINGERPRINT_KEY,
              OPERATIONAL_MESSAGING_DESTINATION_KEY_VERSION:
                OPERATIONAL_MESSAGING_DESTINATION_KEY_VERSION ?? '1'
            }
          : {}),
        ...(STRIPE_SECRET_KEY ? { STRIPE_SECRET_KEY } : {}),
        ...(STRIPE_WEBHOOK_SECRET ? { STRIPE_WEBHOOK_SECRET } : {}),
        ...(CUSTOMER_AUTH_SECRET ? { CUSTOMER_AUTH_SECRET } : {}),
        ...(CUSTOMER_GOOGLE_CLIENT_SECRET ? { CUSTOMER_GOOGLE_CLIENT_SECRET } : {}),
        ...(CUSTOMER_APPLE_CLIENT_SECRET ? { CUSTOMER_APPLE_CLIENT_SECRET } : {})
      },
      env: {
        ...optionalModuleEnv,
        PUBLIC_SITE_ORIGIN: publicSiteOrigin,
        PAYMENT_PROVIDER_NAME: 'stripe',
        PAYMENT_PROVIDER_METHODS: process.env.PAYMENT_PROVIDER_METHODS ?? 'card',
        CUSTOMER_GOOGLE_ENABLED: process.env.CUSTOMER_GOOGLE_ENABLED ?? 'false',
        CUSTOMER_GOOGLE_CLIENT_ID: process.env.CUSTOMER_GOOGLE_CLIENT_ID ?? '',
        CUSTOMER_APPLE_ENABLED: process.env.CUSTOMER_APPLE_ENABLED ?? 'false',
        CUSTOMER_APPLE_CLIENT_ID: process.env.CUSTOMER_APPLE_CLIENT_ID ?? ''
      },
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
        CUSTOMER_DIRECTORY_FINGERPRINT_KEY,
        CONFIRMATION_SIGNING_KEYS,
        CONFIRMATION_CURRENT_KEY_ID,
        ...(OPERATIONAL_MESSAGING_DESTINATION_ENCRYPTION_KEY &&
        OPERATIONAL_MESSAGING_DESTINATION_FINGERPRINT_KEY
          ? {
              OPERATIONAL_MESSAGING_DESTINATION_ENCRYPTION_KEY,
              OPERATIONAL_MESSAGING_DESTINATION_FINGERPRINT_KEY,
              OPERATIONAL_MESSAGING_DESTINATION_KEY_VERSION:
                OPERATIONAL_MESSAGING_DESTINATION_KEY_VERSION ?? '1'
            }
          : {}),
        ...(META_WHATSAPP_ACCESS_TOKEN ? { META_WHATSAPP_ACCESS_TOKEN } : {}),
        ...(META_WHATSAPP_REFERENCE_ENCRYPTION_KEY
          ? { META_WHATSAPP_REFERENCE_ENCRYPTION_KEY }
          : {}),
        ...(META_WHATSAPP_REFERENCE_FINGERPRINT_KEY
          ? { META_WHATSAPP_REFERENCE_FINGERPRINT_KEY }
          : {}),
        ...(SMSO_API_KEY ? { SMSO_API_KEY } : {}),
        ...(SMSO_CALLBACK_URL ? { SMSO_CALLBACK_URL } : {}),
        ...(SMSO_PROVIDER_REFERENCE_ENCRYPTION_KEY
          ? { SMSO_PROVIDER_REFERENCE_ENCRYPTION_KEY }
          : {}),
        ...(SMSO_PROVIDER_REFERENCE_FINGERPRINT_KEY
          ? { SMSO_PROVIDER_REFERENCE_FINGERPRINT_KEY }
          : {}),
        EMAIL: transactionalEmail
      },
      env: {
        ...optionalModuleEnv,
        PUBLIC_SITE_ORIGIN: publicSiteOrigin,
        CLOUDFLARE_EMAIL_FROM,
        ENVIRONMENT: 'production',
        META_WHATSAPP_PHONE_NUMBER_ID: process.env.META_WHATSAPP_PHONE_NUMBER_ID ?? '',
        META_WHATSAPP_GRAPH_API_VERSION:
          process.env.META_WHATSAPP_GRAPH_API_VERSION ?? '',
        META_WHATSAPP_PROVIDER_ACCOUNT_KEY,
        META_WHATSAPP_REFERENCE_KEY_VERSION:
          process.env.META_WHATSAPP_REFERENCE_KEY_VERSION ?? '1',
        SMSO_SENDER_ID: process.env.SMSO_SENDER_ID ?? '',
        SMSO_PROVIDER_REFERENCE_KEY_VERSION:
          process.env.SMSO_PROVIDER_REFERENCE_KEY_VERSION ?? '1'
      },
      crons: ['*/5 * * * *'],
      compatibility: { date: '2026-05-16' },
      observability,
      placement: smartPlacement
    })

    yield* Cloudflare.QueueConsumer('booking-events-consumer', {
      queueId: bookingEventsQueue.queueId,
      scriptName: background.workerName,
      deadLetterQueue: bookingEventsDeadLetterQueue.queueName,
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
        CUSTOMER_DIRECTORY_FINGERPRINT_KEY,
        EMAIL: transactionalEmail
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
      bookingEventsDeadLetterQueue,
      db,
      merchant,
      operations,
      transactionalEmail,
      web
    }
  })
)

export default Stack
