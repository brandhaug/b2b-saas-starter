import * as Alchemy from 'alchemy'
import * as Cloudflare from 'alchemy/Cloudflare'
import * as Effect from 'effect/Effect'
import * as Redacted from 'effect/Redacted'
import {
  bookingEventsConsumerSettings,
  bookingEventsDeadLetterQueueName,
  bookingEventsQueueName
} from './infra/bindings.ts'
import {
  messagingSecretBindings,
  validateQualificationConfiguration
} from './infra/operational-messaging-runtime.ts'

const required = (name: string): string => {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Missing messaging qualification setting: ${name}`)
  return value
}
const secret = (name: string) => Redacted.make(required(name))
const qualificationApiHostname = new URL(required('QUALIFICATION_API_ORIGIN')).hostname
const qualificationConfiguration = validateQualificationConfiguration({
  deployment: 'qualification',
  customerTrafficEnabled: false,
  configured: messagingSecretBindings.filter((name) => process.env[name]?.trim())
})
if (qualificationConfiguration.state !== 'ready')
  throw new Error(
    `Messaging qualification configuration is blocked: ${[
      ...qualificationConfiguration.missing,
      ...qualificationConfiguration.violations
    ].join(', ')}`
  )

/**
 * Isolated production-like messaging qualification stack. It deliberately deploys
 * no Public Site, Booking App, Merchant App, or Operations App, so no customer
 * traffic can create Notification Intents. The API exists only for health and
 * provider callback qualification against a separate migrated D1 database.
 */
export const MessagingQualificationStack = Alchemy.Stack(
  'beesolo-messaging-qualification',
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state()
  },
  Effect.gen(function* () {
    const db = yield* Cloudflare.D1Database('messaging-qualification-db', {
      name: 'beesolo-messaging-qualification',
      migrationsDir: './packages/db/migrations'
    })
    const queue = yield* Cloudflare.Queue('messaging-qualification-queue', {
      name: `${bookingEventsQueueName}-qualification`
    })
    const deadLetterQueue = yield* Cloudflare.Queue(
      'messaging-qualification-dead-letter-queue',
      { name: `${bookingEventsDeadLetterQueueName}-qualification` }
    )

    const metaReferenceFingerprint = secret('META_WHATSAPP_REFERENCE_FINGERPRINT_KEY')
    const smsoReferenceFingerprint = secret('SMSO_PROVIDER_REFERENCE_FINGERPRINT_KEY')
    const api = yield* Cloudflare.Worker('messaging-qualification-api', {
      name: 'beesolo-messaging-qualification-api',
      url: false,
      domain: qualificationApiHostname,
      main: './apps/api/src/index.ts',
      bindings: {
        DB: db,
        BOOKING_EVENTS_QUEUE: queue,
        PLATFORM_API_CURSOR_SECRET: secret('PLATFORM_API_CURSOR_SECRET'),
        META_WHATSAPP_APP_SECRET: secret('META_WHATSAPP_APP_SECRET'),
        META_WHATSAPP_WEBHOOK_VERIFY_TOKEN: secret(
          'META_WHATSAPP_WEBHOOK_VERIFY_TOKEN'
        ),
        META_WHATSAPP_REFERENCE_FINGERPRINT_KEY: metaReferenceFingerprint,
        SMSO_CALLBACK_PATH_SECRET: secret('SMSO_CALLBACK_PATH_SECRET'),
        SMSO_PROVIDER_REFERENCE_FINGERPRINT_KEY: smsoReferenceFingerprint
      },
      env: {
        ENVIRONMENT: 'production',
        META_WHATSAPP_PROVIDER_ACCOUNT_KEY:
          process.env.META_WHATSAPP_PROVIDER_ACCOUNT_KEY ?? 'qualification-meta'
      },
      compatibility: { date: '2026-05-16' },
      observability: { enabled: true, logs: { enabled: true, invocationLogs: true } }
    })

    const background = yield* Cloudflare.Worker('messaging-qualification-background', {
      name: 'beesolo-messaging-qualification-background',
      url: false,
      main: './apps/background/src/index.ts',
      bindings: {
        DB: db,
        BOOKING_EVENTS_QUEUE: queue,
        OPERATIONAL_MESSAGING_DESTINATION_ENCRYPTION_KEY: secret(
          'OPERATIONAL_MESSAGING_DESTINATION_ENCRYPTION_KEY'
        ),
        OPERATIONAL_MESSAGING_DESTINATION_FINGERPRINT_KEY: secret(
          'OPERATIONAL_MESSAGING_DESTINATION_FINGERPRINT_KEY'
        ),
        META_WHATSAPP_ACCESS_TOKEN: secret('META_WHATSAPP_ACCESS_TOKEN'),
        META_WHATSAPP_REFERENCE_ENCRYPTION_KEY: secret(
          'META_WHATSAPP_REFERENCE_ENCRYPTION_KEY'
        ),
        META_WHATSAPP_REFERENCE_FINGERPRINT_KEY: metaReferenceFingerprint,
        SMSO_API_KEY: secret('SMSO_API_KEY'),
        SMSO_CALLBACK_URL: secret('SMSO_CALLBACK_URL'),
        SMSO_PROVIDER_REFERENCE_ENCRYPTION_KEY: secret(
          'SMSO_PROVIDER_REFERENCE_ENCRYPTION_KEY'
        ),
        SMSO_PROVIDER_REFERENCE_FINGERPRINT_KEY: smsoReferenceFingerprint
      },
      env: {
        ENVIRONMENT: 'production',
        OPERATIONAL_MESSAGING_DESTINATION_KEY_VERSION:
          process.env.OPERATIONAL_MESSAGING_DESTINATION_KEY_VERSION ?? '1',
        META_WHATSAPP_PHONE_NUMBER_ID: required('META_WHATSAPP_PHONE_NUMBER_ID'),
        META_WHATSAPP_GRAPH_API_VERSION: required('META_WHATSAPP_GRAPH_API_VERSION'),
        META_WHATSAPP_PROVIDER_ACCOUNT_KEY:
          process.env.META_WHATSAPP_PROVIDER_ACCOUNT_KEY ?? 'qualification-meta',
        META_WHATSAPP_REFERENCE_KEY_VERSION:
          process.env.META_WHATSAPP_REFERENCE_KEY_VERSION ?? '1',
        SMSO_SENDER_ID: required('SMSO_SENDER_ID'),
        SMSO_PROVIDER_REFERENCE_KEY_VERSION:
          process.env.SMSO_PROVIDER_REFERENCE_KEY_VERSION ?? '1'
      },
      crons: ['*/5 * * * *'],
      compatibility: { date: '2026-05-16' },
      observability: {
        enabled: true,
        logs: { enabled: true, invocationLogs: true }
      }
    })

    yield* Cloudflare.QueueConsumer('messaging-qualification-consumer', {
      queueId: queue.queueId,
      scriptName: background.workerName,
      deadLetterQueue: deadLetterQueue.queueName,
      settings: bookingEventsConsumerSettings
    })

    return { api, background, db, queue, deadLetterQueue }
  })
)

export default MessagingQualificationStack
