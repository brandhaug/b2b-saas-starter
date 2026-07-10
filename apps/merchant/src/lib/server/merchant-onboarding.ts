import { env } from 'cloudflare:workers'
import { createServerFn } from '@tanstack/react-start'
import { Effect, Schema } from 'effect'
import {
  MerchantOnboarding,
  MerchantOnboardingPayload,
  selectCapabilitiesLayer,
  type MerchantOnboardingStatus,
  type MerchantRecord
} from '@b2b-saas-starter/capabilities'
import { requireMerchantRequestSession } from './merchant-session.ts'

const decodeInput = Schema.decodeUnknownSync(MerchantOnboardingPayload)

const runMerchantCatalog = <A, E>(effect: Effect.Effect<A, E, MerchantOnboarding>) => {
  if (!env.DB) {
    throw new Error('Merchant Onboarding requires the Merchant App D1 binding.')
  }
  return Effect.runPromise(
    Effect.provide(effect, selectCapabilitiesLayer({ DB: env.DB }))
  )
}

export const getMerchantOnboardingStatus = createServerFn({ method: 'GET' }).handler(
  async (): Promise<MerchantOnboardingStatus> => {
    const session = await requireMerchantRequestSession()
    return runMerchantCatalog(
      Effect.flatMap(MerchantOnboarding, (onboarding) =>
        onboarding.status(session.user.id)
      )
    )
  }
)

export const completeMerchantOnboarding = createServerFn({ method: 'POST' })
  .validator((input: unknown) => decodeInput(input))
  .handler(async ({ data }): Promise<MerchantRecord> => {
    const session = await requireMerchantRequestSession()
    return runMerchantCatalog(
      Effect.flatMap(MerchantOnboarding, (onboarding) =>
        onboarding.complete(session.user.id, data)
      )
    )
  })
