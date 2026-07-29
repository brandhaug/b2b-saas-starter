import { parsePhoneNumberFromString } from 'libphonenumber-js'
import { Context, Effect, Layer, Redacted, Schema } from 'effect'
import { CapabilityUnavailable } from '../errors.ts'
import { ShopId } from '../ids.ts'
import {
  MessagingChannel,
  MessagingLocale,
  MessagingProvider,
  OperationalNotificationPurpose,
  ProviderFingerprint,
  ProtectedNotificationMaterial,
  ProviderUtcInstant
} from './provider-contracts.ts'

type Purpose = typeof OperationalNotificationPurpose.Type

export const ControlledTemplateFacts = Schema.Struct({
  merchantLabel: Schema.String,
  merchantSmsLabel: Schema.String,
  localizedDate: Schema.String,
  smsDate: Schema.String,
  time: Schema.String,
  locationLabel: Schema.String,
  locationSmsLabel: Schema.String,
  reference: Schema.String,
  confirmationUrl: Schema.String
})
export type ControlledTemplateFacts = typeof ControlledTemplateFacts.Type

export const ControlledTemplateInvalidReason = Schema.Literals([
  'merchant_label_too_long',
  'merchant_sms_label_too_long',
  'localized_date_too_long',
  'sms_date_invalid',
  'time_invalid',
  'location_label_too_long',
  'location_sms_label_too_long',
  'reference_too_long',
  'confirmation_url_invalid',
  'confirmation_url_not_allowed',
  'url_not_allowed',
  'unknown_controlled_field',
  'required_field_missing',
  'template_pattern_missing',
  'template_fingerprint_mismatch',
  'whatsapp_envelope_exceeded',
  'sms_not_ascii',
  'sms_not_gsm7',
  'sms_segment_exceeded'
])

export class ControlledTemplateInvalid extends Schema.TaggedErrorClass<ControlledTemplateInvalid>()(
  'ControlledTemplateInvalid',
  {
    reason: ControlledTemplateInvalidReason,
    field: Schema.optional(Schema.String)
  }
) {}

export const ProtectedMessagingDestination = Schema.Struct({
  ciphertext: ProtectedNotificationMaterial,
  fingerprint: Schema.String.check(Schema.isPattern(/^sha256:[a-f0-9]{64}$/)),
  maskedValue: Schema.String.check(Schema.isPattern(/^\+40•{7}\d{3}$/)),
  countryCode: Schema.Literal('RO'),
  keyVersion: Schema.Int.check(Schema.isGreaterThan(0))
})

export class ProtectedDestinationFailure extends Schema.TaggedErrorClass<ProtectedDestinationFailure>()(
  'ProtectedDestinationFailure',
  {
    reason: Schema.Literals([
      'invalid_destination',
      'unsupported_country',
      'protection_failed'
    ])
  }
) {}

export const ProviderTemplateApproval = Schema.Struct({
  provider: Schema.Literal('meta'),
  templateKey: Schema.String,
  requestedCategory: Schema.Literals(['utility', 'marketing', 'authentication']),
  observedCategory: Schema.optional(
    Schema.Literals(['utility', 'marketing', 'authentication'])
  ),
  status: Schema.Literals(['pending', 'approved', 'rejected', 'disabled']),
  approvedAt: Schema.optional(ProviderUtcInstant),
  evidenceReference: Schema.optional(Schema.String)
})

export const ControlledTemplate = Schema.Struct({
  id: Schema.String,
  locale: MessagingLocale,
  purpose: OperationalNotificationPurpose,
  channel: MessagingChannel,
  version: Schema.Int.check(Schema.isGreaterThan(0)),
  bodyFingerprint: ProviderFingerprint,
  enabled: Schema.Boolean,
  providerApproval: Schema.NullOr(ProviderTemplateApproval)
})
export type ControlledTemplate = typeof ControlledTemplate.Type

const purposes: readonly Purpose[] = [
  'appointment_confirmation',
  'appointment_reminder',
  'appointment_cancellation',
  'appointment_reschedule'
]

const bodyFingerprints: Readonly<Record<string, string>> = {
  'ro:appointment_confirmation:whatsapp':
    'sha256:252c1d7edf64265eccfd0f6f81d41976396d97253af1888c74eb61aeba7a9338',
  'ro:appointment_confirmation:sms:v1':
    'sha256:998a641d32a9d74e4b30775ca9090c951705ec7a90b65e78bc97d5360631e3fa',
  'ro:appointment_confirmation:sms:v2':
    'sha256:8ac171f906f52b00208f763498085d1f8286954bd2dd097dc81a23c790fdb904',
  'ro:appointment_reminder:whatsapp':
    'sha256:d8b34a816668643b8518574525c159ba16fd7fa2412481f086e4d8701ed671a0',
  'ro:appointment_reminder:sms:v1':
    'sha256:b90b61075a5b34649b2c26d29204db64bec322ae04d15dd786858eada237f3c4',
  'ro:appointment_reminder:sms:v2':
    'sha256:d964cc92477f25d7316b38985de9d7aeee01ec545f10a3a5623d8dfa5968af48',
  'ro:appointment_cancellation:whatsapp':
    'sha256:2633b940e84a515922c9606b7c695ce0a87eefa29d60011dd1938c3aba860f10',
  'ro:appointment_cancellation:sms:v1':
    'sha256:44278a7d1b3f175aeb41526c5e846233f90eddbf99379ae84e306c3709ea4320',
  'ro:appointment_cancellation:sms:v2':
    'sha256:02307e9d2565a858372740eca43b2876a656c23d68f4cf6114dc36a7882daa0c',
  'ro:appointment_reschedule:whatsapp':
    'sha256:75bb42949e955ff5129e121d6a79175ab2270ee35a4e448ce75d0106c94770e6',
  'ro:appointment_reschedule:sms:v1':
    'sha256:e2ced6a7f80e92a6b0842075e89111edfa5973651b8aa9631910a04aeb3634c3',
  'ro:appointment_reschedule:sms:v2':
    'sha256:ab00343e3ea8253d4f56f9f91886e4c9e08f0c7fe9c694cbb6ad5dcba612163a',
  'en:appointment_confirmation:whatsapp':
    'sha256:b968cdc7530c9953831af9c6cec67894c0f357cd093cb03ff5a364597e5bbd1a',
  'en:appointment_confirmation:sms:v1':
    'sha256:97c4eca8d01d2172238b26a13d9802ef963ed3a13ba9b9caf652745d9e39c418',
  'en:appointment_confirmation:sms:v2':
    'sha256:e5b130fc44c795704a34c249ee2bcf73fb8262cc87b95e2850c28ed7015a0961',
  'en:appointment_reminder:whatsapp':
    'sha256:1b25cb9b1f4d4e2ce41e7546633e2ce46b9ce41e8ec0cf3674dd4c9d39629f66',
  'en:appointment_reminder:sms:v1':
    'sha256:4cfc41cd2f6129a398ad47e23695def3f14c37d4b53e14af68a6d13cc4704a1a',
  'en:appointment_reminder:sms:v2':
    'sha256:7ba1118d0a7d5d8dd14d409e6e59e6a2740a08dfcb5011b152986a5fa926fc81',
  'en:appointment_cancellation:whatsapp':
    'sha256:712918e11451dd0054fa6da46d3ef272d10ccfee58c9e607742beff690a3c0e9',
  'en:appointment_cancellation:sms:v1':
    'sha256:b8aa7fe41d5ddf3f053f9d904ce2e1cdb19f5a999a51bea7ac09e9d51fc5422d',
  'en:appointment_cancellation:sms:v2':
    'sha256:3aa790c23299c3c15ab1af855d3f0281847eae6b22adff79f60990e378ebeae1',
  'en:appointment_reschedule:whatsapp':
    'sha256:2ddf8130d014974a516d26a958c114521eacafc85fea44926ce8f925a0e49609',
  'en:appointment_reschedule:sms:v1':
    'sha256:eafb2b2640eadc54c20005aedb8facf2a4efed6c314e5802ad220ca143ee07cf',
  'en:appointment_reschedule:sms:v2':
    'sha256:1ddcf05959fed546b2a3467edf8b61a1fc3875e4c8ba72f143c3ec7fdf4811af'
}

export const controlledTemplateCatalog: readonly ControlledTemplate[] = (
  ['ro', 'en'] as const
).flatMap((locale) =>
  purposes.flatMap((purpose) =>
    (['whatsapp', 'sms'] as const).flatMap((channel) =>
      (channel === 'sms' ? [1, 2] : [1]).map((version) => ({
        id: `mtv_${locale}_${purpose}_${channel}_v${version}`,
        locale,
        purpose,
        channel,
        version,
        bodyFingerprint:
          bodyFingerprints[
            channel === 'sms'
              ? `${locale}:${purpose}:${channel}:v${version}`
              : `${locale}:${purpose}:${channel}`
          ]!,
        enabled: channel === 'sms' && version === 2,
        providerApproval:
          channel === 'whatsapp'
            ? {
                provider: 'meta' as const,
                templateKey: `beesolo_${purpose}_${locale}_v${version}`,
                requestedCategory: 'utility' as const,
                status: 'pending' as const
              }
            : null
      }))
    )
  )
)

const controlledBodyPatterns: Readonly<Record<string, string>> = {
  mtv_ro_appointment_confirmation_whatsapp_v1:
    'Programarea la {{merchantLabel}} este confirmată pentru {{localizedDate}}, {{time}}, la {{locationLabel}}. Referință: {{reference}}. Detalii: {{confirmationUrl}}. Pentru ajutor, contactează comerciantul sau suportul beesolo.',
  mtv_ro_appointment_confirmation_sms_v1:
    '{{merchantSmsLabel}}: Confirmat {{smsDate}} {{time}}, {{locationSmsLabel}}. Ref {{reference}}. {{confirmationUrl}}',
  mtv_ro_appointment_confirmation_sms_v2:
    '{{merchantSmsLabel}}: Confirmat {{smsDate}} {{time}}, {{locationSmsLabel}}. Ref {{reference}}. {{confirmationUrl}} Aj/STOP:firma/beesolo',
  mtv_ro_appointment_reminder_whatsapp_v1:
    'Memento de la {{merchantLabel}}: programarea este {{localizedDate}}, {{time}}, la {{locationLabel}}. Referință: {{reference}}. Pentru ajutor, contactează comerciantul sau suportul beesolo.',
  mtv_ro_appointment_reminder_sms_v1:
    '{{merchantSmsLabel}}: Memento {{smsDate}} {{time}}, {{locationSmsLabel}}. Ref {{reference}}.',
  mtv_ro_appointment_reminder_sms_v2:
    '{{merchantSmsLabel}}: Memento {{smsDate}} {{time}}, {{locationSmsLabel}}. Ref {{reference}}. Aj/STOP:firma/beesolo',
  mtv_ro_appointment_cancellation_whatsapp_v1:
    '{{merchantLabel}} a anulat programarea din {{localizedDate}}, {{time}}. Referință: {{reference}}. Pentru ajutor, contactează comerciantul sau suportul beesolo.',
  mtv_ro_appointment_cancellation_sms_v1:
    '{{merchantSmsLabel}}: Anulat {{smsDate}} {{time}}. Ref {{reference}}.',
  mtv_ro_appointment_cancellation_sms_v2:
    '{{merchantSmsLabel}}: Anulat {{smsDate}} {{time}}. Ref {{reference}}. Aj/STOP:firma/beesolo',
  mtv_ro_appointment_reschedule_whatsapp_v1:
    '{{merchantLabel}} a reprogramat programarea pentru {{localizedDate}}, {{time}}, la {{locationLabel}}. Referință: {{reference}}. Pentru ajutor, contactează comerciantul sau suportul beesolo.',
  mtv_ro_appointment_reschedule_sms_v1:
    '{{merchantSmsLabel}}: Reprogramat {{smsDate}} {{time}}, {{locationSmsLabel}}. Ref {{reference}}.',
  mtv_ro_appointment_reschedule_sms_v2:
    '{{merchantSmsLabel}}: Reprogramat {{smsDate}} {{time}}, {{locationSmsLabel}}. Ref {{reference}}. Aj/STOP:firma/beesolo',
  mtv_en_appointment_confirmation_whatsapp_v1:
    'Your appointment with {{merchantLabel}} is confirmed for {{localizedDate}} at {{time}}, at {{locationLabel}}. Reference: {{reference}}. Details: {{confirmationUrl}}. For help, contact the merchant or beesolo support.',
  mtv_en_appointment_confirmation_sms_v1:
    '{{merchantSmsLabel}}: Confirmed {{smsDate}} {{time}}, {{locationSmsLabel}}. Ref {{reference}}. {{confirmationUrl}}',
  mtv_en_appointment_confirmation_sms_v2:
    '{{merchantSmsLabel}}: Confirmed {{smsDate}} {{time}}, {{locationSmsLabel}}. Ref {{reference}}. {{confirmationUrl}} Help/STOP:biz/beesolo',
  mtv_en_appointment_reminder_whatsapp_v1:
    'Reminder from {{merchantLabel}}: your appointment is {{localizedDate}} at {{time}}, at {{locationLabel}}. Reference: {{reference}}. For help, contact the merchant or beesolo support.',
  mtv_en_appointment_reminder_sms_v1:
    '{{merchantSmsLabel}}: Reminder {{smsDate}} {{time}}, {{locationSmsLabel}}. Ref {{reference}}.',
  mtv_en_appointment_reminder_sms_v2:
    '{{merchantSmsLabel}}: Reminder {{smsDate}} {{time}}, {{locationSmsLabel}}. Ref {{reference}}. Help/STOP:biz/beesolo',
  mtv_en_appointment_cancellation_whatsapp_v1:
    '{{merchantLabel}} cancelled your appointment for {{localizedDate}} at {{time}}. Reference: {{reference}}. For help, contact the merchant or beesolo support.',
  mtv_en_appointment_cancellation_sms_v1:
    '{{merchantSmsLabel}}: Cancelled {{smsDate}} {{time}}. Ref {{reference}}.',
  mtv_en_appointment_cancellation_sms_v2:
    '{{merchantSmsLabel}}: Cancelled {{smsDate}} {{time}}. Ref {{reference}}. Help/STOP:biz/beesolo',
  mtv_en_appointment_reschedule_whatsapp_v1:
    '{{merchantLabel}} rescheduled your appointment to {{localizedDate}} at {{time}}, at {{locationLabel}}. Reference: {{reference}}. For help, contact the merchant or beesolo support.',
  mtv_en_appointment_reschedule_sms_v1:
    '{{merchantSmsLabel}}: Rescheduled {{smsDate}} {{time}}, {{locationSmsLabel}}. Ref {{reference}}.',
  mtv_en_appointment_reschedule_sms_v2:
    '{{merchantSmsLabel}}: Rescheduled {{smsDate}} {{time}}, {{locationSmsLabel}}. Ref {{reference}}. Help/STOP:biz/beesolo'
}

const transliteration = new Map<string, string>([
  ['ă', 'a'],
  ['â', 'a'],
  ['î', 'i'],
  ['ș', 's'],
  ['ş', 's'],
  ['ț', 't'],
  ['ţ', 't'],
  ['Ă', 'A'],
  ['Â', 'A'],
  ['Î', 'I'],
  ['Ș', 'S'],
  ['Ş', 'S'],
  ['Ț', 'T'],
  ['Ţ', 'T']
])

export const transliterateRomanianSms = (value: string): string =>
  Array.from(value, (character) => transliteration.get(character) ?? character)
    .join('')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')

const GSM7_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'
const GSM7_EXTENSION = '^{}\\[~]|€'

export const countGsm7Units = (value: string): number | null => {
  let units = 0
  for (const character of value) {
    if (GSM7_BASIC.includes(character)) units += 1
    else if (GSM7_EXTENSION.includes(character)) units += 2
    else return null
  }
  return units
}

const toHex = (value: ArrayBuffer) =>
  [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, '0')).join('')

const toBase64 = (value: Uint8Array) => {
  let binary = ''
  for (const byte of value) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export const protectRomanianDestination = (input: {
  readonly rawDestination: Redacted.Redacted<string>
  readonly countryCode: string
  readonly encryptionKey: Redacted.Redacted<Uint8Array>
  readonly fingerprintKey: Redacted.Redacted<Uint8Array>
  readonly keyVersion: number
}) =>
  Effect.gen(function* () {
    if (input.countryCode !== 'RO')
      return yield* Effect.fail(
        new ProtectedDestinationFailure({ reason: 'unsupported_country' })
      )
    const parsed = parsePhoneNumberFromString(
      Redacted.value(input.rawDestination),
      'RO'
    )
    if (!parsed?.isValid())
      return yield* Effect.fail(
        new ProtectedDestinationFailure({ reason: 'invalid_destination' })
      )
    if (parsed.country !== 'RO')
      return yield* Effect.fail(
        new ProtectedDestinationFailure({ reason: 'unsupported_country' })
      )
    const normalized = parsed.number
    return yield* Effect.tryPromise({
      try: async () => {
        const encryptionKey = await crypto.subtle.importKey(
          'raw',
          new Uint8Array(Redacted.value(input.encryptionKey)).buffer,
          'AES-GCM',
          false,
          ['encrypt']
        )
        const fingerprintKey = await crypto.subtle.importKey(
          'raw',
          new Uint8Array(Redacted.value(input.fingerprintKey)).buffer,
          { name: 'HMAC', hash: 'SHA-256' },
          false,
          ['sign']
        )
        const encoded = new TextEncoder().encode(normalized)
        const fingerprint = await crypto.subtle.sign('HMAC', fingerprintKey, encoded)
        const iv = crypto.getRandomValues(new Uint8Array(12))
        const encrypted = new Uint8Array(
          await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, encryptionKey, encoded)
        )
        const envelope = new Uint8Array(iv.length + encrypted.length)
        envelope.set(iv)
        envelope.set(encrypted, iv.length)
        return {
          ciphertext: Redacted.make(toBase64(envelope)),
          fingerprint: `sha256:${toHex(fingerprint)}`,
          maskedValue: `+40•••••••${normalized.slice(-3)}`,
          countryCode: 'RO' as const,
          keyVersion: input.keyVersion
        }
      },
      catch: () => new ProtectedDestinationFailure({ reason: 'protection_failed' })
    })
  })

const urlPattern = /(?:https?:\/\/|www\.)/i
const controlledFactFields = new Set([
  'merchantLabel',
  'merchantSmsLabel',
  'localizedDate',
  'smsDate',
  'time',
  'locationLabel',
  'locationSmsLabel',
  'reference',
  'confirmationUrl'
])

const invalidFacts = (
  template: ControlledTemplate,
  facts: ControlledTemplateFacts
): ControlledTemplateInvalid | null => {
  const fail = (reason: typeof ControlledTemplateInvalidReason.Type, field?: string) =>
    new ControlledTemplateInvalid({ reason, ...(field ? { field } : {}) })
  const unknownField = Object.keys(facts).find(
    (field) => !controlledFactFields.has(field)
  )
  if (unknownField) return fail('unknown_controlled_field', unknownField)
  for (const field of [
    'merchantLabel',
    'merchantSmsLabel',
    'localizedDate',
    'smsDate',
    'time',
    'locationLabel',
    'locationSmsLabel',
    'reference'
  ] as const)
    if (!facts[field].trim()) return fail('required_field_missing', field)
  if (facts.merchantLabel.length > 40)
    return fail('merchant_label_too_long', 'merchantLabel')
  if (facts.merchantSmsLabel.length > 24)
    return fail('merchant_sms_label_too_long', 'merchantSmsLabel')
  if (facts.localizedDate.length > 32)
    return fail('localized_date_too_long', 'localizedDate')
  if (!/^\d{2}\.\d{2}\.\d{4}$/.test(facts.smsDate))
    return fail('sms_date_invalid', 'smsDate')
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(facts.time))
    return fail('time_invalid', 'time')
  if (facts.locationLabel.length > 64)
    return fail('location_label_too_long', 'locationLabel')
  if (facts.locationSmsLabel.length > 28)
    return fail('location_sms_label_too_long', 'locationSmsLabel')
  if (facts.reference.length > 12) return fail('reference_too_long', 'reference')
  if (template.channel === 'sms') {
    for (const field of [
      'merchantSmsLabel',
      'locationSmsLabel',
      'reference'
    ] as const) {
      const transliterated = transliterateRomanianSms(facts[field])
      if (
        countGsm7Units(transliterated) !== null &&
        !/^[\x20-\x7e]+$/.test(transliterated)
      )
        return fail('sms_not_ascii', field)
    }
  }
  for (const [field, value] of Object.entries(facts)) {
    if (field !== 'confirmationUrl' && urlPattern.test(value))
      return fail('url_not_allowed', field)
  }
  if (template.purpose === 'appointment_confirmation') {
    if (
      facts.confirmationUrl.length > 31 ||
      !/^https:\/\/bsolo\.ro\/c\/[A-Za-z0-9_-]+$/.test(facts.confirmationUrl)
    )
      return fail('confirmation_url_invalid', 'confirmationUrl')
  } else if (facts.confirmationUrl)
    return fail('confirmation_url_not_allowed', 'confirmationUrl')
  return null
}

const renderPattern = (
  pattern: string,
  channel: typeof MessagingChannel.Type,
  facts: ControlledTemplateFacts
) => {
  const values: Readonly<Record<string, string>> =
    channel === 'sms'
      ? {
          ...facts,
          merchantSmsLabel: transliterateRomanianSms(facts.merchantSmsLabel),
          locationSmsLabel: transliterateRomanianSms(facts.locationSmsLabel),
          reference: transliterateRomanianSms(facts.reference)
        }
      : facts
  return pattern.replace(
    /\{\{([A-Za-z][A-Za-z0-9]*)\}\}/g,
    (_, field: string) => values[field] ?? ''
  )
}

export const renderControlledTemplate = ({
  template,
  facts
}: {
  readonly template: ControlledTemplate
  readonly facts: ControlledTemplateFacts
}) =>
  Effect.gen(function* () {
    const invalid = invalidFacts(template, facts)
    if (invalid) return yield* Effect.fail(invalid)
    const pattern = controlledBodyPatterns[template.id]
    if (!pattern)
      return yield* Effect.fail(
        new ControlledTemplateInvalid({
          reason: 'template_pattern_missing'
        })
      )
    const actualFingerprint = `sha256:${toHex(
      yield* Effect.promise(() =>
        crypto.subtle.digest('SHA-256', new TextEncoder().encode(pattern))
      )
    )}`
    if (actualFingerprint !== template.bodyFingerprint)
      return yield* Effect.fail(
        new ControlledTemplateInvalid({
          reason: 'template_fingerprint_mismatch'
        })
      )
    const body = renderPattern(pattern, template.channel, facts)
    if (template.channel === 'whatsapp' && body.length > 500)
      return yield* Effect.fail(
        new ControlledTemplateInvalid({
          reason: 'whatsapp_envelope_exceeded'
        })
      )
    const gsm7Units = template.channel === 'sms' ? countGsm7Units(body) : null
    if (template.channel === 'sms' && gsm7Units === null)
      return yield* Effect.fail(
        new ControlledTemplateInvalid({ reason: 'sms_not_gsm7' })
      )
    if (gsm7Units !== null && gsm7Units > 160)
      return yield* Effect.fail(
        new ControlledTemplateInvalid({ reason: 'sms_segment_exceeded' })
      )
    return {
      body: Redacted.make(body),
      gsm7Units
    }
  })

export const OperationalMessageIneligibleReason = Schema.Literals([
  'operational_permission_missing',
  'operational_permission_destination_mismatch',
  'destination_suppressed',
  'channel_suppressed',
  'global_kill_switch',
  'merchant_messaging_disabled',
  'merchant_frozen',
  'notification_purpose_disabled',
  'channel_kill_switch',
  'provider_needs_configuration',
  'route_not_supported',
  'template_version_not_found',
  'template_disabled',
  'template_not_approved',
  'template_category_mismatch',
  'template_approval_evidence_missing',
  'template_content_mismatch',
  'invalid_eligibility_input',
  'invalid_controlled_content',
  'invalid_shop_timezone',
  'reminder_no_longer_useful'
])

export class OperationalMessageIneligible extends Schema.TaggedErrorClass<OperationalMessageIneligible>()(
  'OperationalMessageIneligible',
  {
    reason: OperationalMessageIneligibleReason
  }
) {}

export const SuppressionDirective = Schema.Struct({
  shopId: Schema.NullOr(ShopId),
  destinationFingerprint: ProviderFingerprint,
  scope: Schema.Union([Schema.Literal('all_operational'), MessagingChannel]),
  effectiveAt: ProviderUtcInstant,
  expiresAt: Schema.optional(ProviderUtcInstant),
  revokedAt: Schema.optional(ProviderUtcInstant)
})
export type SuppressionDirective = typeof SuppressionDirective.Type

export const OperationalMessageEligibilityInput = Schema.Struct({
  shopId: ShopId,
  purpose: OperationalNotificationPurpose,
  locale: MessagingLocale,
  channel: MessagingChannel,
  provider: MessagingProvider,
  templateVersion: Schema.Int.check(Schema.isGreaterThan(0)),
  destinationFingerprint: ProviderFingerprint,
  permission: Schema.Struct({
    granted: Schema.Boolean,
    destinationFingerprint: ProviderFingerprint
  }),
  suppressions: Schema.Array(SuppressionDirective),
  controls: Schema.Struct({
    globalEnabled: Schema.Boolean,
    merchantEnabled: Schema.Boolean,
    merchantFrozen: Schema.Boolean,
    purposeEnabled: Schema.Boolean,
    channelEnabled: Schema.Boolean,
    providerConfigured: Schema.Boolean
  }),
  now: ProviderUtcInstant,
  appointmentStartsAt: ProviderUtcInstant,
  shopTimeZone: Schema.String,
  facts: ControlledTemplateFacts
})
export type OperationalMessageEligibilityInput =
  typeof OperationalMessageEligibilityInput.Type

const ineligible = (reason: typeof OperationalMessageIneligibleReason.Type) =>
  Effect.fail(new OperationalMessageIneligible({ reason }))

const activeSuppression = (
  directive: SuppressionDirective,
  input: OperationalMessageEligibilityInput
) => {
  const now = Date.parse(input.now)
  return (
    directive.destinationFingerprint === input.destinationFingerprint &&
    (directive.shopId === null || directive.shopId === input.shopId) &&
    Date.parse(directive.effectiveAt) <= now &&
    (!directive.expiresAt || Date.parse(directive.expiresAt) > now) &&
    (!directive.revokedAt || Date.parse(directive.revokedAt) > now)
  )
}

const localParts = (instant: string, timeZone: string) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).formatToParts(new Date(instant))
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? ''
  return {
    date: `${read('year')}-${read('month')}-${read('day')}`,
    time: `${read('hour')}:${read('minute')}`
  }
}

const addCalendarDays = (date: string, days: number): string => {
  const value = new Date(`${date}T12:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

const zonedInstant = (date: string, time: string, timeZone: string): Date => {
  const desired = Date.parse(`${date}T${time}:00.000Z`)
  let candidate = desired
  for (let index = 0; index < 3; index += 1) {
    const representedParts = localParts(new Date(candidate).toISOString(), timeZone)
    const represented = Date.parse(
      `${representedParts.date}T${representedParts.time}:00.000Z`
    )
    candidate += desired - represented
  }
  return new Date(candidate)
}

const reminderAvailableAt = (
  input: OperationalMessageEligibilityInput
): Effect.Effect<string, OperationalMessageIneligible> =>
  Effect.gen(function* () {
    const now = new Date(input.now)
    const appointment = new Date(input.appointmentStartsAt)
    if (
      Number.isNaN(now.getTime()) ||
      Number.isNaN(appointment.getTime()) ||
      now >= appointment
    )
      return yield* ineligible('reminder_no_longer_useful')
    const local = localParts(input.now, input.shopTimeZone)
    let available = now
    if (local.time < '08:00')
      available = zonedInstant(local.date, '08:00', input.shopTimeZone)
    else if (local.time >= '20:00')
      available = zonedInstant(
        addCalendarDays(local.date, 1),
        '08:00',
        input.shopTimeZone
      )
    if (available >= appointment) return yield* ineligible('reminder_no_longer_useful')
    return available.toISOString()
  })

export const evaluateOperationalMessageEligibility = (
  rawInput: unknown,
  options: {
    readonly catalog: readonly ControlledTemplate[]
  } = { catalog: controlledTemplateCatalog }
) =>
  Effect.gen(function* () {
    const input = yield* Schema.decodeUnknownEffect(OperationalMessageEligibilityInput)(
      rawInput
    ).pipe(
      Effect.mapError(
        () =>
          new OperationalMessageIneligible({
            reason: 'invalid_eligibility_input'
          })
      )
    )
    if (!input.permission.granted)
      return yield* ineligible('operational_permission_missing')
    if (input.permission.destinationFingerprint !== input.destinationFingerprint)
      return yield* ineligible('operational_permission_destination_mismatch')
    const activeSuppressions = input.suppressions.filter((directive) =>
      activeSuppression(directive, input)
    )
    if (activeSuppressions.some((directive) => directive.scope === 'all_operational'))
      return yield* ineligible('destination_suppressed')
    if (activeSuppressions.some((directive) => directive.scope === input.channel))
      return yield* ineligible('channel_suppressed')
    if (!input.controls.globalEnabled) return yield* ineligible('global_kill_switch')
    if (!input.controls.merchantEnabled)
      return yield* ineligible('merchant_messaging_disabled')
    if (input.controls.merchantFrozen) return yield* ineligible('merchant_frozen')
    if (!input.controls.purposeEnabled)
      return yield* ineligible('notification_purpose_disabled')
    if (!input.controls.channelEnabled) return yield* ineligible('channel_kill_switch')
    if (!input.controls.providerConfigured)
      return yield* ineligible('provider_needs_configuration')
    if (
      (input.channel === 'whatsapp' && input.provider !== 'meta') ||
      (input.channel === 'sms' && input.provider !== 'smso')
    )
      return yield* ineligible('route_not_supported')

    const template = options.catalog.find(
      (candidate) =>
        candidate.purpose === input.purpose &&
        candidate.locale === input.locale &&
        candidate.channel === input.channel &&
        candidate.version === input.templateVersion
    )
    if (!template) return yield* ineligible('template_version_not_found')
    if (!template.enabled) return yield* ineligible('template_disabled')
    const controlledVersion = controlledTemplateCatalog.find(
      (candidate) =>
        candidate.purpose === template.purpose &&
        candidate.locale === template.locale &&
        candidate.channel === template.channel &&
        candidate.version === template.version
    )
    if (
      !controlledVersion ||
      controlledVersion.bodyFingerprint !== template.bodyFingerprint
    )
      return yield* ineligible('template_content_mismatch')
    const providerApproval = template.providerApproval
    if (template.channel === 'whatsapp' && providerApproval?.status !== 'approved')
      return yield* ineligible('template_not_approved')
    if (
      template.channel === 'whatsapp' &&
      (providerApproval?.requestedCategory !== 'utility' ||
        providerApproval.observedCategory !== 'utility')
    )
      return yield* ineligible('template_category_mismatch')
    if (
      template.channel === 'whatsapp' &&
      (!providerApproval?.templateKey ||
        !providerApproval.approvedAt ||
        !providerApproval.evidenceReference)
    )
      return yield* ineligible('template_approval_evidence_missing')

    yield* Effect.try({
      try: () =>
        new Intl.DateTimeFormat('en', {
          timeZone: input.shopTimeZone
        }).format(0),
      catch: () =>
        new OperationalMessageIneligible({
          reason: 'invalid_shop_timezone'
        })
    })
    const rendered = yield* renderControlledTemplate({
      template,
      facts: input.facts
    }).pipe(
      Effect.mapError(
        (error) =>
          new OperationalMessageIneligible({
            reason:
              error.reason === 'template_pattern_missing' ||
              error.reason === 'template_fingerprint_mismatch'
                ? 'template_content_mismatch'
                : 'invalid_controlled_content'
          })
      )
    )
    const availableAt =
      input.purpose === 'appointment_reminder'
        ? yield* reminderAvailableAt(input)
        : input.now
    return {
      template,
      rendered,
      availableAt
    }
  })

export type ControlledTemplateEligibilityEngineShape = {
  readonly evaluate: (input: unknown) => Effect.Effect<
    {
      readonly template: ControlledTemplate
      readonly rendered: {
        readonly body: Redacted.Redacted<string>
        readonly gsm7Units: number | null
      }
      readonly availableAt: string
    },
    OperationalMessageIneligible | CapabilityUnavailable
  >
}

export class ControlledTemplateEligibilityEngine extends Context.Service<
  ControlledTemplateEligibilityEngine,
  ControlledTemplateEligibilityEngineShape
>()(
  '@b2b-saas-starter/capabilities/notifications/ControlledTemplateEligibilityEngine'
) {}

export const SeedControlledTemplateEligibilityEngine = (
  catalog: readonly ControlledTemplate[] = controlledTemplateCatalog
): Layer.Layer<ControlledTemplateEligibilityEngine> =>
  Layer.succeed(ControlledTemplateEligibilityEngine)({
    evaluate: (input) => evaluateOperationalMessageEligibility(input, { catalog })
  })
