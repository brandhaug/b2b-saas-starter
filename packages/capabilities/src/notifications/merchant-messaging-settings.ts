import { Context, Effect, Layer, Schema } from 'effect'
import { and, eq, isNotNull, isNull } from 'drizzle-orm'
import {
  Database,
  merchantMessagingControls,
  messagingTemplateVersions,
  shops
} from '@b2b-saas-starter/db'
import { CapabilityUnavailable } from '../errors.ts'
import { orUnavailable } from '../internal/unavailable.ts'
import { renderControlledTemplatePreview } from './controlled-template-eligibility.ts'

const purposeNames = [
  'appointment_confirmation',
  'appointment_reschedule',
  'appointment_cancellation',
  'appointment_reminder'
] as const

export const MerchantMessagingSettingsInput = Schema.Struct({
  merchantId: Schema.String,
  enabled: Schema.Boolean,
  confirmationEnabled: Schema.Boolean,
  rescheduleEnabled: Schema.Boolean,
  cancellationEnabled: Schema.Boolean,
  reminderEnabled: Schema.Boolean,
  reminderLeadHours: Schema.Literals([2, 24, 48]),
  now: Schema.String
})
export type MerchantMessagingSettingsInput = typeof MerchantMessagingSettingsInput.Type

export const MerchantMessagingTemplatePreview = Schema.Struct({
  purpose: Schema.Literals(purposeNames),
  locale: Schema.Literals(['ro', 'en']),
  body: Schema.String
})

export const MerchantMessagingSettingsProjection = Schema.Struct({
  merchantId: Schema.String,
  enabled: Schema.Boolean,
  controls: Schema.Struct({
    confirmation: Schema.Literals(['send', 'dont_send']),
    reschedule: Schema.Literals(['send', 'dont_send']),
    cancellation: Schema.Literals(['send', 'dont_send']),
    reminder: Schema.Literals(['send', 'dont_send'])
  }),
  reminderLeadHours: Schema.Literals([2, 24, 48]),
  deliveryWindow: Schema.Literal('08:00–20:00 Shop time'),
  state: Schema.Literals(['ready', 'disabled', 'needs_configuration']),
  frozen: Schema.Boolean,
  previews: Schema.Array(MerchantMessagingTemplatePreview)
})
export type MerchantMessagingSettingsProjection =
  typeof MerchantMessagingSettingsProjection.Type

export const merchantReminderAvailableAt = (input: {
  readonly startsAt: string
  readonly now: string
  readonly controls: {
    readonly enabled: boolean
    readonly reminderEnabled: boolean
    readonly reminderLeadMinutes: number | null
    readonly frozen: boolean
  } | null
}) => {
  const lead = input.controls?.reminderLeadMinutes
  if (
    !input.controls?.enabled ||
    !input.controls.reminderEnabled ||
    input.controls.frozen ||
    (lead !== 120 && lead !== 1440 && lead !== 2880)
  )
    return null
  const availableAt = new Date(Date.parse(input.startsAt) - lead * 60_000).toISOString()
  return availableAt > input.now ? availableAt : null
}

export class MerchantMessagingSettingsNotFound extends Schema.TaggedErrorClass<MerchantMessagingSettingsNotFound>()(
  'MerchantMessagingSettingsNotFound',
  { merchantId: Schema.String }
) {}

export class MerchantMessagingSettingsFrozen extends Schema.TaggedErrorClass<MerchantMessagingSettingsFrozen>()(
  'MerchantMessagingSettingsFrozen',
  { merchantId: Schema.String }
) {}

type SettingsError =
  | MerchantMessagingSettingsNotFound
  | MerchantMessagingSettingsFrozen
  | CapabilityUnavailable

export type MerchantMessagingSettingsShape = {
  readonly read: (input: {
    readonly merchantId: string
  }) => Effect.Effect<MerchantMessagingSettingsProjection, SettingsError>
  readonly save: (
    input: MerchantMessagingSettingsInput
  ) => Effect.Effect<MerchantMessagingSettingsProjection, SettingsError>
}

export class MerchantMessagingSettings extends Context.Service<
  MerchantMessagingSettings,
  MerchantMessagingSettingsShape
>()('@b2b-saas-starter/capabilities/notifications/MerchantMessagingSettings') {}

const previews = Effect.forEach(
  (['ro', 'en'] as const).flatMap((locale) =>
    purposeNames.map((purpose) => ({ locale, purpose }))
  ),
  ({ locale, purpose }) => {
    return Effect.map(renderControlledTemplatePreview({ locale, purpose }), (body) => ({
      purpose,
      locale,
      body
    }))
  }
).pipe(
  Effect.mapError(
    (error) =>
      new CapabilityUnavailable({
        capability: 'merchant-messaging-settings',
        reason: error.reason
      })
  )
)

type StoredControls = {
  readonly enabled: boolean
  readonly confirmationEnabled: boolean
  readonly rescheduleEnabled: boolean
  readonly cancellationEnabled: boolean
  readonly reminderEnabled: boolean
  readonly reminderLeadMinutes: number | null
  readonly frozen: boolean
}

const projection = (
  merchantId: string,
  controls: StoredControls,
  templateConfigured: boolean,
  renderedPreviews: readonly (typeof MerchantMessagingTemplatePreview.Type)[]
): MerchantMessagingSettingsProjection => ({
  merchantId,
  enabled: controls.enabled,
  controls: {
    confirmation: controls.confirmationEnabled ? 'send' : 'dont_send',
    reschedule: controls.rescheduleEnabled ? 'send' : 'dont_send',
    cancellation: controls.cancellationEnabled ? 'send' : 'dont_send',
    reminder: controls.reminderEnabled ? 'send' : 'dont_send'
  },
  reminderLeadHours:
    controls.reminderLeadMinutes === 120 ||
    controls.reminderLeadMinutes === 1440 ||
    controls.reminderLeadMinutes === 2880
      ? ((controls.reminderLeadMinutes / 60) as 2 | 24 | 48)
      : 24,
  deliveryWindow: '08:00–20:00 Shop time',
  state: controls.frozen
    ? 'disabled'
    : templateConfigured
      ? 'ready'
      : 'needs_configuration',
  frozen: controls.frozen,
  previews: [...renderedPreviews]
})

const defaults = (): StoredControls => ({
  enabled: false,
  confirmationEnabled: true,
  rescheduleEnabled: true,
  cancellationEnabled: true,
  reminderEnabled: true,
  reminderLeadMinutes: 1440,
  frozen: false
})

export const SeedMerchantMessagingSettings =
  (): Layer.Layer<MerchantMessagingSettings> => {
    const records = new Map<string, StoredControls>()
    const read = (merchantId: string) =>
      Effect.map(previews, (examples) =>
        projection(merchantId, records.get(merchantId) ?? defaults(), true, examples)
      )
    return Layer.succeed(MerchantMessagingSettings)({
      read: ({ merchantId }) => read(merchantId),
      save: (input) => {
        if (records.get(input.merchantId)?.frozen)
          return Effect.fail(
            new MerchantMessagingSettingsFrozen({ merchantId: input.merchantId })
          )
        records.set(input.merchantId, {
          enabled: input.enabled,
          confirmationEnabled: input.confirmationEnabled,
          rescheduleEnabled: input.rescheduleEnabled,
          cancellationEnabled: input.cancellationEnabled,
          reminderEnabled: input.reminderEnabled,
          reminderLeadMinutes: input.reminderLeadHours * 60,
          frozen: false
        })
        return read(input.merchantId)
      }
    })
  }

export const LiveMerchantMessagingSettings: Layer.Layer<
  MerchantMessagingSettings,
  never,
  Database
> = Layer.effect(
  MerchantMessagingSettings,
  Effect.gen(function* () {
    const db = yield* Database
    const load = (merchantId: string) =>
      Effect.gen(function* () {
        const [shop] = yield* orUnavailable('merchant-messaging-settings')(
          db
            .select({ id: shops.id })
            .from(shops)
            .where(eq(shops.merchantId, merchantId))
            .limit(1)
        )
        if (!shop) return yield* new MerchantMessagingSettingsNotFound({ merchantId })
        const [rows, templates, examples] = yield* Effect.all([
          orUnavailable('merchant-messaging-settings')(
            db
              .select()
              .from(merchantMessagingControls)
              .where(eq(merchantMessagingControls.shopId, shop.id))
              .limit(1)
          ),
          orUnavailable('merchant-messaging-settings')(
            db
              .select({
                purpose: messagingTemplateVersions.purpose,
                locale: messagingTemplateVersions.locale
              })
              .from(messagingTemplateVersions)
              .where(
                and(
                  eq(messagingTemplateVersions.channel, 'whatsapp'),
                  eq(messagingTemplateVersions.version, 1),
                  eq(messagingTemplateVersions.enabled, true),
                  eq(messagingTemplateVersions.providerRequestedCategory, 'utility'),
                  eq(messagingTemplateVersions.providerObservedCategory, 'utility'),
                  eq(messagingTemplateVersions.providerApprovalStatus, 'approved'),
                  isNotNull(messagingTemplateVersions.providerApprovedAt),
                  isNotNull(
                    messagingTemplateVersions.providerApprovalEvidenceReference
                  ),
                  isNull(messagingTemplateVersions.retiredAt)
                )
              )
          ),
          previews
        ])
        return {
          shopId: shop.id,
          controls: rows[0] ?? defaults(),
          configured:
            new Set(
              templates.map((template) => `${template.purpose}:${template.locale}`)
            ).size ===
            purposeNames.length * 2,
          examples
        }
      })
    const read = (merchantId: string) =>
      Effect.map(load(merchantId), ({ controls, configured, examples }) =>
        projection(merchantId, controls, configured, examples)
      )
    return {
      read: ({ merchantId }) => read(merchantId),
      save: (input) =>
        Effect.gen(function* () {
          const current = yield* load(input.merchantId)
          if (current.controls.frozen)
            return yield* new MerchantMessagingSettingsFrozen({
              merchantId: input.merchantId
            })
          const written = yield* orUnavailable('merchant-messaging-settings')(
            db
              .insert(merchantMessagingControls)
              .values({
                shopId: current.shopId,
                enabled: input.enabled,
                confirmationEnabled: input.confirmationEnabled,
                rescheduleEnabled: input.rescheduleEnabled,
                cancellationEnabled: input.cancellationEnabled,
                reminderEnabled: input.reminderEnabled,
                reminderLeadMinutes: input.reminderLeadHours * 60,
                createdAt: input.now,
                updatedAt: input.now
              })
              .onConflictDoUpdate({
                target: merchantMessagingControls.shopId,
                setWhere: eq(merchantMessagingControls.frozen, false),
                set: {
                  enabled: input.enabled,
                  confirmationEnabled: input.confirmationEnabled,
                  rescheduleEnabled: input.rescheduleEnabled,
                  cancellationEnabled: input.cancellationEnabled,
                  reminderEnabled: input.reminderEnabled,
                  reminderLeadMinutes: input.reminderLeadHours * 60,
                  updatedAt: input.now
                }
              })
              .returning({ shopId: merchantMessagingControls.shopId })
          )
          if (written.length === 0)
            return yield* new MerchantMessagingSettingsFrozen({
              merchantId: input.merchantId
            })
          return yield* read(input.merchantId)
        })
    }
  })
)
