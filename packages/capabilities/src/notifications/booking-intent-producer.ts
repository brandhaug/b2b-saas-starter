import { Effect, Redacted, Schema } from 'effect'
import { and, eq, inArray, isNull, lt } from 'drizzle-orm'
import {
  deliveryRoutes,
  notificationIntentControlledFacts,
  notificationIntents,
  protectedMessagingDestinations,
  type BatchStatement,
  type EffectDatabase
} from '@b2b-saas-starter/db'
import { CapabilityUnavailable } from '../errors.ts'
import {
  ControlledTemplateFacts,
  protectRomanianDestination
} from './controlled-template-eligibility.ts'
import {
  NotificationIntentAggregateSchema,
  type NotificationPurpose
} from './notification-intent-lifecycle.ts'
import type { BookingEventsWakeup } from './provider-contracts.ts'

export type NotificationDestinationProtection = {
  readonly encryptionKey: Redacted.Redacted<Uint8Array>
  readonly fingerprintKey: Redacted.Redacted<Uint8Array>
  readonly keyVersion: number
}

export const NotificationDestinationProtectionSecrets = Schema.Struct({
  encryption: Schema.String.check(Schema.isMinLength(1)),
  fingerprint: Schema.String.check(Schema.isMinLength(1)),
  keyVersion: Schema.Int.check(Schema.isGreaterThan(0))
})
export type NotificationDestinationProtectionSecrets =
  typeof NotificationDestinationProtectionSecrets.Type

export const hasNotificationDestinationProtection = (
  secrets: NotificationDestinationProtectionSecrets | undefined
): secrets is NotificationDestinationProtectionSecrets =>
  Schema.is(NotificationDestinationProtectionSecrets)(secrets)

export type BookingIntentPreparationInput = {
  readonly shopId: string
  readonly sourceId: string
  readonly sourceVersion: number
  readonly semanticDeduplicationKey: string
  readonly rawDestination: string | null
  readonly permissionGranted: boolean
  readonly purpose: NotificationPurpose
  readonly locale: 'ro' | 'en'
  readonly availableAt: string
  readonly appointmentStartsAt: string
  readonly createdAt: string
  readonly traceId: string
  readonly facts: ControlledTemplateFacts
}

const statements = Symbol('notification-intent-producer-statements')

export type PreparedBookingIntentMutation = {
  readonly intentId: string
  readonly wakeup: BookingEventsWakeup
  readonly [statements]: readonly BatchStatement[]
}

export const notificationIntentMutationStatements = (
  mutation: PreparedBookingIntentMutation
): readonly BatchStatement[] => mutation[statements]

const hex = (value: ArrayBuffer) =>
  Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, '0')).join(
    ''
  )

const sha256 = (value: string) =>
  Effect.map(
    Effect.promise(() =>
      crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
    ),
    (digest) => `sha256:${hex(digest)}`
  )

const deriveKey = (secret: string, purpose: string) =>
  Effect.map(
    Effect.promise(() =>
      crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(`booking-operational-messaging:${purpose}:${secret}`)
      )
    ),
    (digest) => Redacted.make(new Uint8Array(digest))
  )

export const deriveNotificationDestinationProtection = (
  secrets: NotificationDestinationProtectionSecrets
): Effect.Effect<NotificationDestinationProtection> =>
  Effect.all({
    encryptionKey: deriveKey(secrets.encryption, 'encryption'),
    fingerprintKey: deriveKey(secrets.fingerprint, 'fingerprint'),
    keyVersion: Effect.succeed(secrets.keyVersion)
  })

const purposeTopic: Readonly<Record<NotificationPurpose, string>> = {
  appointment_confirmation: 'appointment.confirmation',
  appointment_reminder: 'appointment.reminder',
  appointment_cancellation: 'appointment.cancellation',
  appointment_reschedule: 'appointment.reschedule'
}

const suffix = (fingerprint: string) => fingerprint.slice('sha256:'.length, 25)

export const prepareBookingIntentMutation = (
  db: EffectDatabase,
  input: BookingIntentPreparationInput,
  protection: NotificationDestinationProtection
): Effect.Effect<PreparedBookingIntentMutation | null, CapabilityUnavailable> =>
  Effect.gen(function* () {
    if (!input.rawDestination) return null
    const destination = yield* protectRomanianDestination({
      rawDestination: Redacted.make(input.rawDestination),
      countryCode: 'RO',
      encryptionKey: protection.encryptionKey,
      fingerprintKey: protection.fingerprintKey,
      keyVersion: protection.keyVersion
    })
    const destinationSnapshot = {
      ...destination,
      ciphertext: Redacted.value(destination.ciphertext)
    }
    const deduplicationKey = input.semanticDeduplicationKey
    const identityFingerprint = yield* sha256(deduplicationKey)
    const intentId = `nti_${suffix(identityFingerprint)}`
    const phase = input.availableAt > input.createdAt ? 'scheduled' : 'ready'
    const aggregate = Schema.decodeUnknownSync(NotificationIntentAggregateSchema)({
      id: intentId,
      shopId: input.shopId,
      topic: purposeTopic[input.purpose],
      sourceType: 'appointment',
      sourceId: input.sourceId,
      sourceVersion: input.sourceVersion,
      recipientRole: 'customer',
      recipientSnapshot: destinationSnapshot,
      deduplicationKey,
      purpose: input.purpose,
      locale: input.locale,
      availableAt: input.availableAt,
      createdAt: input.createdAt,
      phase,
      supersededAfterSubmission: false,
      routes: [
        {
          id: `drt_${suffix(identityFingerprint)}_wa`,
          ordinal: 0,
          channel: 'whatsapp',
          provider: 'meta',
          state: 'planned',
          attempts: [],
          submissionOutcomes: [],
          evidence: []
        },
        {
          id: `drt_${suffix(identityFingerprint)}_sms`,
          ordinal: 1,
          channel: 'sms',
          provider: 'smso',
          state: 'planned',
          attempts: [],
          submissionOutcomes: [],
          evidence: []
        }
      ],
      reconciliationCases: []
    })
    const factsJson = yield* Effect.try({
      try: () => Schema.decodeUnknownSync(ControlledTemplateFacts)(input.facts),
      catch: () =>
        new CapabilityUnavailable({
          capability: 'booking-intent-producer',
          reason: 'controlled_template_facts_invalid'
        })
    })
    const factsFingerprint = yield* sha256(JSON.stringify(factsJson))
    const expiresAt = new Date(
      Date.parse(input.appointmentStartsAt) + 30 * 24 * 60 * 60_000
    ).toISOString()
    const recipientJson = JSON.stringify({
      role: aggregate.recipientRole,
      destination: destinationSnapshot
    })
    const { recipientSnapshot: _, ...safeLifecycle } = aggregate
    const payloadJson = JSON.stringify({
      operationalMessagingLifecycle: safeLifecycle,
      permission: {
        granted: input.permissionGranted,
        destinationFingerprint: destinationSnapshot.fingerprint
      },
      appointmentStartsAt: input.appointmentStartsAt,
      controlledFacts: factsJson
    })
    const mutations: readonly BatchStatement[] = [
      db
        .insert(notificationIntents)
        .values({
          id: intentId,
          shopId: input.shopId,
          topic: aggregate.topic,
          recipientJson,
          payloadJson,
          sourceType: aggregate.sourceType,
          sourceId: aggregate.sourceId,
          sourceVersion: aggregate.sourceVersion,
          deduplicationKey,
          purpose: input.purpose,
          phase,
          locale: input.locale,
          traceId: input.traceId,
          status: 'pending',
          availableAt: input.availableAt,
          createdAt: input.createdAt,
          updatedAt: input.createdAt
        })
        .onConflictDoNothing(),
      db
        .insert(protectedMessagingDestinations)
        .values({
          id: `pmd_${suffix(identityFingerprint)}`,
          shopId: input.shopId,
          intentId,
          ciphertext: destinationSnapshot.ciphertext,
          keyVersion: destinationSnapshot.keyVersion,
          fingerprint: destinationSnapshot.fingerprint,
          maskedValue: destinationSnapshot.maskedValue,
          countryCode: destinationSnapshot.countryCode,
          createdAt: input.createdAt
        })
        .onConflictDoNothing(),
      db
        .insert(notificationIntentControlledFacts)
        .values({
          intentId,
          shopId: input.shopId,
          templateVersionId: `mtv_${input.locale}_${input.purpose}_whatsapp_v1`,
          factsJson,
          factsFingerprint,
          createdAt: input.createdAt,
          expiresAt
        })
        .onConflictDoNothing(),
      ...aggregate.routes.map((route) =>
        db
          .insert(deliveryRoutes)
          .values({
            id: route.id,
            shopId: input.shopId,
            intentId,
            ordinal: route.ordinal,
            channel: route.channel,
            provider: route.provider,
            state: route.state,
            createdAt: input.createdAt,
            updatedAt: input.createdAt
          })
          .onConflictDoNothing()
      )
    ]
    return {
      intentId,
      wakeup: { version: 1 as const, kind: 'notification-intent' as const, intentId },
      [statements]: mutations
    }
  }).pipe(Effect.catchTag('ProtectedDestinationFailure', () => Effect.succeed(null)))

export const supersedeObsoleteBookingIntentMutations = (
  db: EffectDatabase,
  input: {
    readonly sourceId: string
    readonly beforeVersion: number
    readonly now: string
  }
): readonly BatchStatement[] => [
  db
    .update(notificationIntents)
    .set({
      supersededAt: input.now,
      supersededAfterSubmission: false,
      phase: 'terminal',
      result: 'not_sent',
      resultReason: 'superseded',
      terminalAt: input.now,
      status: 'cancelled',
      updatedAt: input.now
    })
    .where(
      and(
        eq(notificationIntents.sourceType, 'appointment'),
        eq(notificationIntents.sourceId, input.sourceId),
        lt(notificationIntents.sourceVersion, input.beforeVersion),
        isNull(notificationIntents.terminalAt),
        inArray(notificationIntents.phase, ['scheduled', 'ready'])
      )
    ),
  db
    .update(notificationIntents)
    .set({
      supersededAt: input.now,
      supersededAfterSubmission: true,
      updatedAt: input.now
    })
    .where(
      and(
        eq(notificationIntents.sourceType, 'appointment'),
        eq(notificationIntents.sourceId, input.sourceId),
        lt(notificationIntents.sourceVersion, input.beforeVersion),
        isNull(notificationIntents.terminalAt),
        inArray(notificationIntents.phase, ['routing', 'awaiting_provider'])
      )
    )
]
