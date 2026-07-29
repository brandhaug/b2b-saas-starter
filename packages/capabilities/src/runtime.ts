import { Effect, Layer } from 'effect'
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
export { SeedLayer, type CapabilitiesLayer, type CapabilityServices } from './layers.ts'
export { CapabilityUnavailable } from './errors.ts'

type D1Binding = Parameters<typeof makeLiveLayerFromD1>[0]

export type BookingProductEnv = {
  readonly DB: D1Binding
  readonly PLATFORM_API_CURSOR_SECRET?: string | undefined
  readonly REQUIRE_PLATFORM_API_CURSOR_SECRET?: boolean | undefined
  readonly OPERATIONAL_MESSAGING_DESTINATION_ENCRYPTION_KEY?: string | undefined
  readonly OPERATIONAL_MESSAGING_DESTINATION_FINGERPRINT_KEY?: string | undefined
  readonly OPERATIONAL_MESSAGING_DESTINATION_KEY_VERSION?: string | undefined
  readonly SMSO_API_KEY?: string | undefined
  readonly SMSO_SENDER_ID?: string | undefined
  readonly SMSO_CALLBACK_URL?: string | undefined
  readonly SMSO_PROVIDER_REFERENCE_ENCRYPTION_KEY?: string | undefined
  readonly SMSO_PROVIDER_REFERENCE_FINGERPRINT_KEY?: string | undefined
  readonly SMSO_PROVIDER_REFERENCE_KEY_VERSION?: string | undefined
}

export const selectCapabilitiesLayer = (
  env: BookingProductEnv,
  options: Pick<
    import('./layers.ts').LiveCapabilitiesOptions,
    'confirmationKeyring' | 'notificationDestinationSecrets'
  > = {}
): CapabilitiesLayer => {
  const destinationSecrets =
    options.notificationDestinationSecrets ??
    (env.OPERATIONAL_MESSAGING_DESTINATION_ENCRYPTION_KEY &&
    env.OPERATIONAL_MESSAGING_DESTINATION_FINGERPRINT_KEY
      ? {
          encryption: env.OPERATIONAL_MESSAGING_DESTINATION_ENCRYPTION_KEY,
          fingerprint: env.OPERATIONAL_MESSAGING_DESTINATION_FINGERPRINT_KEY,
          keyVersion: Number(env.OPERATIONAL_MESSAGING_DESTINATION_KEY_VERSION ?? '1')
        }
      : undefined)
  return makeLiveLayerFromD1(env.DB, {
    platformApiCursorSecret: env.PLATFORM_API_CURSOR_SECRET,
    requirePlatformApiCursorSecret: env.REQUIRE_PLATFORM_API_CURSOR_SECRET,
    confirmationKeyring: options.confirmationKeyring,
    ...(destinationSecrets
      ? { notificationDestinationSecrets: destinationSecrets }
      : {})
  })
}

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
  const providerLayer = liveSmso
    ? Layer.succeed(ProviderSubmission)({
        submit: (request) =>
          request.provider === 'smso'
            ? liveSmso.submit(request)
            : providers.meta.submit(request)
      })
    : providers.layer
  const encryptionSecret = env.OPERATIONAL_MESSAGING_DESTINATION_ENCRYPTION_KEY?.trim()
  const keyVersion = Number(env.OPERATIONAL_MESSAGING_DESTINATION_KEY_VERSION ?? '1')
  return makeNotificationIntentExecutionLayer({
    environment: env.ENVIRONMENT ?? 'development',
    providerAccountKeys: { meta: 'platform-meta', smso: 'platform-smso' },
    providerConfigured: {
      meta: providers.meta.runtimeState === 'capture',
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
