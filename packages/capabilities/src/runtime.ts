import { Effect, Layer, Redacted } from 'effect'
import { layerFromD1 } from '@b2b-saas-starter/db'
import { makeLiveLayerFromD1, type CapabilitiesLayer } from './layers.ts'
import {
  LiveNotificationIntentExecutionStore,
  makeDeterministicProviderSubmissionLayer,
  makeProtectedDestinationReveal
} from './notifications/notification-intent-execution.live.ts'
import { makeNotificationIntentExecutionLayer } from './notifications/notification-intent-execution.ts'
import { ProviderSubmission } from './notifications/provider-contracts.ts'
import { makeLiveProviderAcceptancePersistence } from './notifications/smso-adapter.live.ts'
import { selectConfiguredSmsoAdapter } from './notifications/smso-provider.ts'
import {
  makeD1MetaReferenceProtector,
  makeMetaWhatsAppSubmission
} from './notifications/meta-whatsapp.ts'
import {
  makeConfiguredTransactionalEmailProvider,
  makeLiveTransactionalEmailLayer,
  selectTransactionalEmailProvider
} from './notifications/transactional-email.ts'
import { LiveOperationalMessagingJobs } from './notifications/operational-messaging-jobs.ts'
import { makeLiveAppointmentEmailWorkflows } from './notifications/appointment-email.ts'
export { SeedLayer, type CapabilitiesLayer, type CapabilityServices } from './layers.ts'
export { CapabilityUnavailable } from './errors.ts'

type D1Binding = Parameters<typeof makeLiveLayerFromD1>[0]

export type BookingProductEnv = {
  readonly DB: D1Binding
  readonly BOOKING_EVENTS_QUEUE?:
    | {
        readonly send: (
          message:
            | import('./foundation/index.ts').QueueWakeup
            | import('./notifications/index.ts').AppointmentEmailWakeup
        ) => Promise<unknown>
      }
    | undefined
  readonly PLATFORM_API_CURSOR_SECRET?: string | undefined
  readonly REQUIRE_PLATFORM_API_CURSOR_SECRET?: boolean | undefined
  readonly CUSTOMER_DIRECTORY_FINGERPRINT_KEY?: string | undefined
  readonly REQUIRE_CUSTOMER_DIRECTORY_FINGERPRINT_KEY?: boolean | undefined
  readonly OPERATIONAL_MESSAGING_DESTINATION_ENCRYPTION_KEY?: string | undefined
  readonly OPERATIONAL_MESSAGING_DESTINATION_FINGERPRINT_KEY?: string | undefined
  readonly OPERATIONAL_MESSAGING_DESTINATION_KEY_VERSION?: string | undefined
  readonly SMSO_API_KEY?: string | undefined
  readonly SMSO_SENDER_ID?: string | undefined
  readonly SMSO_CALLBACK_URL?: string | undefined
  readonly SMSO_PROVIDER_REFERENCE_ENCRYPTION_KEY?: string | undefined
  readonly SMSO_PROVIDER_REFERENCE_FINGERPRINT_KEY?: string | undefined
  readonly SMSO_PROVIDER_REFERENCE_KEY_VERSION?: string | undefined
  readonly META_WHATSAPP_ACCESS_TOKEN?: string | undefined
  readonly META_WHATSAPP_PHONE_NUMBER_ID?: string | undefined
  readonly META_WHATSAPP_GRAPH_API_VERSION?: string | undefined
  readonly META_WHATSAPP_PROVIDER_ACCOUNT_KEY?: string | undefined
  readonly META_WHATSAPP_REFERENCE_ENCRYPTION_KEY?: string | undefined
  readonly META_WHATSAPP_REFERENCE_FINGERPRINT_KEY?: string | undefined
  readonly META_WHATSAPP_REFERENCE_KEY_VERSION?: string | undefined
  readonly EMAIL?:
    | {
        readonly send: (message: {
          readonly idempotencyKey?: string
          readonly from: string
          readonly to: string | readonly string[]
          readonly subject: string
          readonly text?: string
          readonly html?: string
          readonly headers?: Readonly<Record<string, string>>
        }) => Promise<unknown>
      }
    | undefined
  readonly CLOUDFLARE_EMAIL_FROM?: string | undefined
  readonly TRANSACTIONAL_EMAIL_SENDER_VERIFIED?: string | undefined
  readonly TRANSACTIONAL_EMAIL_CALLBACK_SECRET?: string | undefined
  readonly TRANSACTIONAL_EMAIL_PROVIDER_REFERENCE_FINGERPRINT_KEY?: string | undefined
  readonly TRANSACTIONAL_EMAIL_DISABLED?: string | undefined
  readonly CONFIRMATION_SIGNING_KEYS?: string | undefined
  readonly CONFIRMATION_CURRENT_KEY_ID?: string | undefined
  readonly PUBLIC_SITE_ORIGIN?: string | undefined
}

export const transactionalEmailIsConfigured = (env: BookingProductEnv) =>
  Boolean(
    env.EMAIL &&
    env.CLOUDFLARE_EMAIL_FROM?.trim() &&
    env.TRANSACTIONAL_EMAIL_SENDER_VERIFIED === 'true' &&
    env.TRANSACTIONAL_EMAIL_CALLBACK_SECRET?.trim() &&
    env.TRANSACTIONAL_EMAIL_PROVIDER_REFERENCE_FINGERPRINT_KEY?.trim()
  )

const configuredTransactionalEmailProvider = (env: BookingProductEnv, send: boolean) =>
  makeConfiguredTransactionalEmailProvider({
    sender: env.CLOUDFLARE_EMAIL_FROM!,
    callbackSecret: env.TRANSACTIONAL_EMAIL_CALLBACK_SECRET!,
    providerReferenceFingerprintKey:
      env.TRANSACTIONAL_EMAIL_PROVIDER_REFERENCE_FINGERPRINT_KEY!,
    ...(send
      ? {
          send: async (message) => {
            const response = await env.EMAIL!.send({
              from: message.from,
              to: message.to,
              subject: message.subject,
              text: message.text,
              headers: { 'X-BeeSolo-Idempotency-Key': message.idempotencyKey }
            })
            if (
              !response ||
              typeof response !== 'object' ||
              !('messageId' in response) ||
              typeof response.messageId !== 'string' ||
              response.messageId.length === 0
            )
              throw new Error('email_provider_acceptance_reference_missing')
            return {
              providerSubmissionId: response.messageId,
              acceptedAt:
                'acceptedAt' in response &&
                typeof response.acceptedAt === 'string' &&
                Number.isFinite(Date.parse(response.acceptedAt))
                  ? response.acceptedAt
                  : new Date().toISOString()
            }
          }
        }
      : {})
  })

export const makeTransactionalEmailCallbackCapabilityLayer = (env: BookingProductEnv) =>
  makeLiveTransactionalEmailLayer(
    configuredTransactionalEmailProvider(env, false)
  ).pipe(Layer.provide(layerFromD1(env.DB)))

export const makeTransactionalEmailCapabilityLayer = (
  env: BookingProductEnv & {
    readonly ENVIRONMENT?: string | undefined
  }
) => {
  const runtime =
    env.ENVIRONMENT === 'test'
      ? ('test' as const)
      : env.ENVIRONMENT === 'development'
        ? ('local' as const)
        : env.ENVIRONMENT === 'preview'
          ? ('preview' as const)
          : ('production' as const)
  const configured = transactionalEmailIsConfigured(env)
  const provider = selectTransactionalEmailProvider({
    runtime,
    disabled: env.TRANSACTIONAL_EMAIL_DISABLED === 'true',
    ...(configured
      ? {
          provider: configuredTransactionalEmailProvider(env, true)
        }
      : {})
  })
  return makeLiveTransactionalEmailLayer(provider).pipe(
    Layer.provide(layerFromD1(env.DB))
  )
}

export const makeAppointmentEmailWorkflowsLayer = (
  env: BookingProductEnv & { readonly ENVIRONMENT?: string | undefined }
) => {
  let confirmationSigningKeys: Readonly<Record<string, string>> = {}
  try {
    confirmationSigningKeys = JSON.parse(
      env.CONFIRMATION_SIGNING_KEYS ?? '{}'
    ) as Readonly<Record<string, string>>
  } catch {
    // A malformed keyring produces an explicit unavailable delivery outcome.
  }
  const runtime =
    env.ENVIRONMENT === 'test'
      ? ('test' as const)
      : env.ENVIRONMENT === 'development'
        ? ('local' as const)
        : env.ENVIRONMENT === 'preview'
          ? ('preview' as const)
          : ('production' as const)
  const provider = selectTransactionalEmailProvider({
    runtime,
    disabled: env.TRANSACTIONAL_EMAIL_DISABLED === 'true',
    ...(transactionalEmailIsConfigured(env)
      ? { provider: configuredTransactionalEmailProvider(env, true) }
      : {})
  })
  return makeLiveAppointmentEmailWorkflows({
    provider,
    destinationEncryptionSecret:
      env.OPERATIONAL_MESSAGING_DESTINATION_ENCRYPTION_KEY ??
      env.TRANSACTIONAL_EMAIL_CALLBACK_SECRET,
    confirmationSigningKeys,
    publicOrigin:
      env.PUBLIC_SITE_ORIGIN ??
      (runtime === 'local' || runtime === 'test' ? 'http://localhost:3071' : undefined)
  }).pipe(Layer.provide(layerFromD1(env.DB)))
}

export const selectCapabilitiesLayer = (
  env: BookingProductEnv,
  options: Pick<
    import('./layers.ts').LiveCapabilitiesOptions,
    | 'confirmationKeyring'
    | 'notificationDestinationSecrets'
    | 'capabilityOutboxHandler'
    | 'merchantAppointmentImpersonatedBy'
  > = {}
): CapabilitiesLayer => {
  let configuredConfirmationKeys: Readonly<Record<string, string>> = {}
  try {
    configuredConfirmationKeys = JSON.parse(
      env.CONFIRMATION_SIGNING_KEYS ?? '{}'
    ) as Readonly<Record<string, string>>
  } catch {
    // Capability operations report the unavailable current key explicitly.
  }
  const confirmationKeyring =
    options.confirmationKeyring ??
    (env.CONFIRMATION_CURRENT_KEY_ID
      ? {
          currentKeyId: env.CONFIRMATION_CURRENT_KEY_ID,
          keys: configuredConfirmationKeys
        }
      : undefined)
  const destinationSecrets =
    options.notificationDestinationSecrets ??
    (env.OPERATIONAL_MESSAGING_DESTINATION_ENCRYPTION_KEY &&
    env.OPERATIONAL_MESSAGING_DESTINATION_FINGERPRINT_KEY
      ? {
          encryption: env.OPERATIONAL_MESSAGING_DESTINATION_ENCRYPTION_KEY,
          fingerprint: env.OPERATIONAL_MESSAGING_DESTINATION_FINGERPRINT_KEY,
          keyVersion: Number(env.OPERATIONAL_MESSAGING_DESTINATION_KEY_VERSION ?? '1')
        }
      : env.TRANSACTIONAL_EMAIL_CALLBACK_SECRET &&
          env.TRANSACTIONAL_EMAIL_PROVIDER_REFERENCE_FINGERPRINT_KEY
        ? {
            encryption: env.TRANSACTIONAL_EMAIL_CALLBACK_SECRET,
            fingerprint: env.TRANSACTIONAL_EMAIL_PROVIDER_REFERENCE_FINGERPRINT_KEY,
            keyVersion: 1
          }
        : undefined)
  return makeLiveLayerFromD1(env.DB, {
    customerDirectoryFingerprintKey: env.CUSTOMER_DIRECTORY_FINGERPRINT_KEY,
    requireCustomerDirectoryFingerprintKey:
      env.REQUIRE_CUSTOMER_DIRECTORY_FINGERPRINT_KEY,
    platformApiCursorSecret: env.PLATFORM_API_CURSOR_SECRET,
    requirePlatformApiCursorSecret: env.REQUIRE_PLATFORM_API_CURSOR_SECRET,
    ...(confirmationKeyring ? { confirmationKeyring } : {}),
    merchantAppointmentImpersonatedBy: options.merchantAppointmentImpersonatedBy,
    capabilityOutboxHandler: options.capabilityOutboxHandler,
    ...(env.BOOKING_EVENTS_QUEUE
      ? {
          capabilityQueueWakeup: async (
            wakeup:
              | import('./foundation/index.ts').QueueWakeup
              | import('./notifications/index.ts').AppointmentEmailWakeup
          ) => {
            await env.BOOKING_EVENTS_QUEUE!.send(wakeup)
          }
        }
      : {}),
    ...(destinationSecrets
      ? { notificationDestinationSecrets: destinationSecrets }
      : {})
  })
}

export const makeOperationalMessagingJobsLayer = (env: BookingProductEnv) =>
  LiveOperationalMessagingJobs.pipe(Layer.provide(layerFromD1(env.DB)))

export const makeOperationalMessagingExecutionLayer = (
  env: BookingProductEnv & { readonly ENVIRONMENT?: string | undefined },
  now: string
) => {
  const providerRuntime =
    env.ENVIRONMENT === 'test'
      ? ('test' as const)
      : env.ENVIRONMENT === 'development'
        ? ('local' as const)
        : env.ENVIRONMENT === 'preview'
          ? ('preview' as const)
          : ('production' as const)
  const providers = makeDeterministicProviderSubmissionLayer(providerRuntime, now)
  const liveSmso = selectConfiguredSmsoAdapter(env, now)
  const metaProviderAccountKey =
    env.META_WHATSAPP_PROVIDER_ACCOUNT_KEY?.trim() || 'platform-meta'
  const metaConfigured = Boolean(
    env.META_WHATSAPP_ACCESS_TOKEN?.trim() &&
    env.META_WHATSAPP_PHONE_NUMBER_ID?.trim() &&
    env.META_WHATSAPP_GRAPH_API_VERSION?.trim() &&
    env.META_WHATSAPP_REFERENCE_ENCRYPTION_KEY?.trim() &&
    env.META_WHATSAPP_REFERENCE_FINGERPRINT_KEY?.trim()
  )
  const liveMeta =
    metaConfigured &&
    (providerRuntime === 'preview' || providerRuntime === 'production')
      ? makeMetaWhatsAppSubmission({
          accessToken: Redacted.make(env.META_WHATSAPP_ACCESS_TOKEN!),
          phoneNumberId: env.META_WHATSAPP_PHONE_NUMBER_ID!,
          graphApiVersion: env.META_WHATSAPP_GRAPH_API_VERSION!,
          providerAccountKey: metaProviderAccountKey,
          protectReference: makeD1MetaReferenceProtector({
            db: env.DB,
            encryptionSecret: env.META_WHATSAPP_REFERENCE_ENCRYPTION_KEY!,
            fingerprintSecret: env.META_WHATSAPP_REFERENCE_FINGERPRINT_KEY!,
            keyVersion: Number(env.META_WHATSAPP_REFERENCE_KEY_VERSION ?? '1'),
            environment: env.ENVIRONMENT ?? 'production'
          }),
          now: () => now
        })
      : undefined
  const providerLayer =
    liveSmso || liveMeta
      ? Layer.succeed(ProviderSubmission)({
          submit: (request) =>
            request.provider === 'smso'
              ? liveSmso
                ? liveSmso.submit(request)
                : providers.smso.submit(request)
              : liveMeta
                ? liveMeta(request)
                : providers.meta.submit(request)
        })
      : providers.layer
  const encryptionSecret = env.OPERATIONAL_MESSAGING_DESTINATION_ENCRYPTION_KEY?.trim()
  const keyVersion = Number(env.OPERATIONAL_MESSAGING_DESTINATION_KEY_VERSION ?? '1')
  return makeNotificationIntentExecutionLayer({
    environment: env.ENVIRONMENT ?? 'development',
    providerAccountKeys: { meta: metaProviderAccountKey, smso: 'platform-smso' },
    providerConfigured: {
      meta: liveMeta ? true : providers.meta.runtimeState === 'capture',
      smso: liveSmso ? true : providers.smso.runtimeState === 'capture'
    },
    destinationConfigured: Boolean(encryptionSecret),
    revealDestination: encryptionSecret
      ? makeProtectedDestinationReveal({ encryptionSecret, keyVersion })
      : () =>
          Effect.die(
            new Error('Operational Messaging destination protection is not configured')
          ),
    ...(liveSmso
      ? {
          persistProviderAcceptance: makeLiveProviderAcceptancePersistence({
            db: env.DB,
            environment: env.ENVIRONMENT ?? 'production',
            encryptionSecret: env.SMSO_PROVIDER_REFERENCE_ENCRYPTION_KEY!,
            keyVersion: liveSmso.providerReferenceKeyVersion
          })
        }
      : {})
  }).pipe(
    Layer.provide(LiveNotificationIntentExecutionStore),
    Layer.provide(providerLayer),
    Layer.provide(selectCapabilitiesLayer(env)),
    Layer.provide(layerFromD1(env.DB))
  )
}
