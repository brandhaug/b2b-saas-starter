import { Redacted } from 'effect'
import { makeSmsoAdapter } from './smso-adapter.ts'

export * from './smso-adapter.ts'
export * from './smso-adapter.live.ts'
export * from './smso-polling.ts'

export type SmsoRuntimeEnv = {
  readonly ENVIRONMENT?: string | undefined
  readonly SMSO_API_KEY?: string | undefined
  readonly SMSO_SENDER_ID?: string | undefined
  readonly SMSO_CALLBACK_URL?: string | undefined
  readonly SMSO_PROVIDER_REFERENCE_ENCRYPTION_KEY?: string | undefined
  readonly SMSO_PROVIDER_REFERENCE_FINGERPRINT_KEY?: string | undefined
  readonly SMSO_PROVIDER_REFERENCE_KEY_VERSION?: string | undefined
}

export const selectConfiguredSmsoAdapter = (
  env: SmsoRuntimeEnv,
  now: string,
  fetch: typeof globalThis.fetch = globalThis.fetch
) => {
  if (env.ENVIRONMENT !== 'preview' && env.ENVIRONMENT !== 'production')
    return undefined
  if (
    !env.SMSO_API_KEY?.trim() ||
    !env.SMSO_SENDER_ID?.trim() ||
    !env.SMSO_CALLBACK_URL?.trim() ||
    !env.SMSO_PROVIDER_REFERENCE_ENCRYPTION_KEY?.trim() ||
    !env.SMSO_PROVIDER_REFERENCE_FINGERPRINT_KEY?.trim()
  )
    return undefined
  const providerReferenceKeyVersion = Number(
    env.SMSO_PROVIDER_REFERENCE_KEY_VERSION ?? '1'
  )
  if (
    !Number.isSafeInteger(providerReferenceKeyVersion) ||
    providerReferenceKeyVersion < 1
  )
    return undefined
  return {
    ...makeSmsoAdapter({
      apiKey: Redacted.make(env.SMSO_API_KEY),
      senderId: env.SMSO_SENDER_ID,
      callbackUrl: Redacted.make(env.SMSO_CALLBACK_URL),
      fingerprintSecret: Redacted.make(env.SMSO_PROVIDER_REFERENCE_FINGERPRINT_KEY),
      providerAccountKey: 'platform-smso',
      environment: env.ENVIRONMENT,
      timeoutMs: 10_000,
      fetch,
      now: () => now
    }),
    providerReferenceKeyVersion
  }
}
