import { env } from 'cloudflare:workers'
import { createServerFn } from '@tanstack/react-start'
import { Effect, Layer, Schema } from 'effect'
import { layerFromD1 } from '@b2b-saas-starter/db'
import {
  MerchantContext,
  liveMerchantContext
} from '@b2b-saas-starter/capabilities/merchant-catalog'
import {
  MerchantMessagingSettings,
  MerchantMessagingSettingsInput,
  type MerchantMessagingSettingsProjection
} from '@b2b-saas-starter/capabilities/notifications'
import { selectCapabilitiesLayer } from '@b2b-saas-starter/capabilities/runtime'
import { runMerchantRequest } from './merchant-session.ts'

const SaveMerchantMessagingSettings = Schema.Struct({
  enabled: MerchantMessagingSettingsInput.fields.enabled,
  confirmationEnabled: MerchantMessagingSettingsInput.fields.confirmationEnabled,
  rescheduleEnabled: MerchantMessagingSettingsInput.fields.rescheduleEnabled,
  cancellationEnabled: MerchantMessagingSettingsInput.fields.cancellationEnabled,
  reminderEnabled: MerchantMessagingSettingsInput.fields.reminderEnabled,
  reminderLeadHours: MerchantMessagingSettingsInput.fields.reminderLeadHours
})

const run = async <A>(
  userId: string,
  effect: Effect.Effect<A, unknown, MerchantContext | MerchantMessagingSettings>
) => {
  if (!env.DB)
    throw new Error('Merchant Messaging requires the Merchant App D1 binding.')
  const context = liveMerchantContext(userId).pipe(Layer.provide(layerFromD1(env.DB)))
  return Effect.runPromise(
    Effect.provide(
      effect,
      Layer.merge(selectCapabilitiesLayer({ DB: env.DB }), context)
    )
  )
}

const readForOwner = (userId: string) =>
  run(
    userId,
    Effect.gen(function* () {
      const merchant = yield* MerchantContext
      const settings = yield* MerchantMessagingSettings
      return yield* settings.read({ merchantId: merchant.id })
    })
  )

export const canManageMerchantMessaging = createServerFn({ method: 'GET' }).handler(
  async () => {
    try {
      await runMerchantRequest('merchant.read', (session) =>
        readForOwner(session.user.id)
      )
      return true
    } catch {
      return false
    }
  }
)

export const getMerchantMessagingSettings = createServerFn({ method: 'GET' }).handler(
  async (): Promise<MerchantMessagingSettingsProjection> =>
    runMerchantRequest('merchant.read', (session) => readForOwner(session.user.id))
)

export const saveMerchantMessagingSettings = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(SaveMerchantMessagingSettings))
  .handler(
    async ({ data }): Promise<MerchantMessagingSettingsProjection> =>
      runMerchantRequest('schedule.update', (session) =>
        run(
          session.user.id,
          Effect.gen(function* () {
            const merchant = yield* MerchantContext
            const settings = yield* MerchantMessagingSettings
            return yield* settings.save({
              merchantId: merchant.id,
              ...data,
              now: new Date().toISOString()
            })
          })
        )
      )
  )
