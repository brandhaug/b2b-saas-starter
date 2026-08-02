import { Context, Effect, Layer, Schema } from 'effect'
import { Database, type EffectDatabase } from '@b2b-saas-starter/db'
import { CapabilityUnavailable } from '../errors.ts'
import { newCapabilityId } from '../internal/ids.ts'
import { MerchantContext } from '../merchant-catalog/merchant-context.ts'
import { Scheduling, SchedulingValidationError } from './scheduling.ts'

export const activationSteps = [
  'business-details',
  'owner-provider',
  'services',
  'weekly-hours',
  'date-overrides-reviewed',
  'booking-policies',
  'notification-readiness',
  'launch-test',
  'publication'
] as const
export type ActivationStep = (typeof activationSteps)[number]

export const BookingPolicies = Schema.Struct({
  minimumNoticeMinutes: Schema.Number.check(
    Schema.isInt(),
    Schema.isBetween({ minimum: 0, maximum: 43_200 })
  ),
  bookingHorizonDays: Schema.Number.check(
    Schema.isInt(),
    Schema.isBetween({ minimum: 1, maximum: 365 })
  ),
  cancellationCutoffHours: Schema.Number.check(
    Schema.isInt(),
    Schema.isBetween({ minimum: 0, maximum: 720 })
  ),
  startTimeIntervalMinutes: Schema.Literals([5, 10, 15, 30]),
  autoConfirm: Schema.Literal(true),
  paymentMethod: Schema.Literal('pay_in_person')
})
export type BookingPolicies = typeof BookingPolicies.Type

export const launchBookingPolicies: BookingPolicies = {
  minimumNoticeMinutes: 120,
  bookingHorizonDays: 60,
  cancellationCutoffHours: 24,
  startTimeIntervalMinutes: 15,
  autoConfirm: true,
  paymentMethod: 'pay_in_person'
}

export const validateBookingPolicies = (policies: BookingPolicies): boolean =>
  policies.minimumNoticeMinutes < policies.bookingHorizonDays * 24 * 60

export type ActivationFacts = {
  readonly businessDetailsComplete: boolean
  readonly ownerProviderConfirmed: boolean
  readonly hasActiveEligibleService: boolean
  readonly hasExplicitWeeklyHours: boolean
  readonly dateOverridesReviewed: boolean
  readonly bookingPoliciesConfirmed: boolean
  readonly notificationAccepted: boolean
  readonly sourceRevision: string
  readonly launchTestSourceRevision: string | null
  readonly subscriptionAccess: boolean
  readonly publishedIntent: boolean
  readonly firstActivatedAt: string | null
  readonly bookingReadiness: boolean
}

export type ActivationProgress = {
  readonly complete: readonly ActivationStep[]
  readonly incomplete: readonly ActivationStep[]
  readonly resumeAt: ActivationStep | null
  readonly readyForFirstPublication: boolean
  readonly currentlyPublic: boolean
  readonly activated: boolean
}

/** Derive progress on every read; callers must not persist this projection. */
export const deriveActivationProgress = (
  facts: ActivationFacts
): ActivationProgress => {
  const checks: Readonly<Record<ActivationStep, boolean>> = {
    'business-details': facts.businessDetailsComplete,
    'owner-provider': facts.ownerProviderConfirmed,
    services: facts.hasActiveEligibleService,
    'weekly-hours': facts.hasExplicitWeeklyHours,
    'date-overrides-reviewed': facts.dateOverridesReviewed,
    'booking-policies': facts.bookingPoliciesConfirmed,
    'notification-readiness': facts.notificationAccepted,
    'launch-test':
      facts.firstActivatedAt !== null ||
      facts.launchTestSourceRevision === facts.sourceRevision,
    publication: facts.firstActivatedAt !== null
  }
  const complete = activationSteps.filter((step) => checks[step])
  const incomplete = activationSteps.filter((step) => !checks[step])
  const activationRequirements = activationSteps.slice(0, -1)
  const readyForFirstPublication = activationRequirements.every((step) => checks[step])
  return {
    complete,
    incomplete,
    resumeAt: facts.firstActivatedAt === null ? (incomplete[0] ?? null) : null,
    readyForFirstPublication,
    currentlyPublic:
      facts.publishedIntent && facts.subscriptionAccess && facts.bookingReadiness,
    activated: facts.firstActivatedAt !== null
  }
}

export type FirstPublicationDecision =
  | { readonly kind: 'publish'; readonly firstActivation: boolean }
  | { readonly kind: 'reject'; readonly incomplete: readonly ActivationStep[] }

/** Must be called with facts read in the same transaction as the status update. */
export const decideFirstPublication = (
  facts: ActivationFacts
): FirstPublicationDecision => {
  const progress = deriveActivationProgress(facts)
  const incomplete: ActivationStep[] = progress.incomplete.filter(
    (step) => step !== 'publication'
  )
  if (!facts.subscriptionAccess && !incomplete.includes('publication'))
    incomplete.push('publication')
  return incomplete.length > 0
    ? { kind: 'reject', incomplete }
    : { kind: 'publish', firstActivation: facts.firstActivatedAt === null }
}

export type LaunchTestInput = {
  readonly serviceId: string
  readonly providerId: string
  readonly startsAt: string
  readonly customer: { readonly name: string; readonly email: string }
}

export type LaunchTestResult = {
  readonly kind: 'simulated-confirmation'
  readonly sourceRevision: string
  readonly createsAppointment: false
  readonly createsCustomerRecord: false
  readonly consumesHold: false
  readonly sendsCustomerNotification: false
}

export class LaunchTestRejected extends Schema.TaggedErrorClass<LaunchTestRejected>()(
  'LaunchTestRejected',
  { reason: Schema.Literals(['invalid_customer', 'slot_unavailable']) }
) {}

export class ActivationRevisionConflict extends Schema.TaggedErrorClass<ActivationRevisionConflict>()(
  'ActivationRevisionConflict',
  { currentRevision: Schema.Number }
) {}

export class ActivationNotReady extends Schema.TaggedErrorClass<ActivationNotReady>()(
  'ActivationNotReady',
  { incomplete: Schema.Array(Schema.String) }
) {}

/** A deliberately pure rehearsal result. Availability must be checked by the caller. */
export const simulateLaunchTest = (
  sourceRevision: string,
  input: LaunchTestInput,
  availableStarts: readonly string[]
): Effect.Effect<LaunchTestResult, LaunchTestRejected> => {
  if (!input.customer.name.trim() || !input.customer.email.includes('@'))
    return Effect.fail(new LaunchTestRejected({ reason: 'invalid_customer' }))
  if (!availableStarts.includes(input.startsAt))
    return Effect.fail(new LaunchTestRejected({ reason: 'slot_unavailable' }))
  return Effect.succeed({
    kind: 'simulated-confirmation',
    sourceRevision,
    createsAppointment: false,
    createsCustomerRecord: false,
    consumesHold: false,
    sendsCustomerNotification: false
  })
}

export type ActivationSnapshot = {
  readonly revision: number
  readonly sourceRevision: string
  readonly policies: BookingPolicies
  readonly progress: ActivationProgress
  readonly facts: ActivationFacts
  readonly firstActivatedAt: string | null
  readonly businessDetails: {
    readonly publicName: string
    readonly slug: string
    readonly country: string
    readonly line1: string
    readonly locality: string
    readonly postalCode: string
    readonly publicPhone: string
    readonly arrivalDirections: string
  }
}

export type ActivationConfirmationInput = {
  readonly expectedRevision: number
  readonly businessDetailsConfirmed?: boolean
  readonly ownerProviderConfirmed?: boolean
  readonly dateOverridesReviewed?: boolean
  readonly policies?: BookingPolicies
  readonly policiesConfirmed?: boolean
}

export const BusinessDetailsInput = Schema.Struct({
  expectedRevision: Schema.Number,
  publicName: Schema.String,
  slug: Schema.String,
  country: Schema.String,
  line1: Schema.String,
  locality: Schema.String,
  postalCode: Schema.String,
  publicPhone: Schema.String,
  arrivalDirections: Schema.optional(Schema.String)
})
export type BusinessDetailsInput = typeof BusinessDetailsInput.Type

type MerchantActivationShape = {
  readonly read: () => Effect.Effect<
    ActivationSnapshot,
    CapabilityUnavailable,
    MerchantContext
  >
  readonly saveConfirmations: (
    input: ActivationConfirmationInput
  ) => Effect.Effect<
    ActivationSnapshot,
    ActivationRevisionConflict | CapabilityUnavailable,
    MerchantContext
  >
  readonly saveBusinessDetails: (
    input: BusinessDetailsInput
  ) => Effect.Effect<
    ActivationSnapshot,
    ActivationRevisionConflict | CapabilityUnavailable,
    MerchantContext
  >
  readonly runLaunchTest: (
    input: LaunchTestInput
  ) => Effect.Effect<
    LaunchTestResult,
    LaunchTestRejected | CapabilityUnavailable | SchedulingValidationError,
    MerchantContext | Scheduling
  >
  readonly publish: () => Effect.Effect<
    { readonly status: 'published'; readonly firstActivatedAt: string },
    ActivationNotReady | CapabilityUnavailable,
    MerchantContext
  >
}

export class MerchantActivation extends Context.Service<
  MerchantActivation,
  MerchantActivationShape
>()('@b2b-saas-starter/capabilities/MerchantActivation') {}

export const SeedMerchantActivation: Layer.Layer<MerchantActivation> = Layer.succeed(
  MerchantActivation
)({
  read: () =>
    Effect.map(MerchantContext, () => {
      const facts: ActivationFacts = {
        businessDetailsComplete: true,
        ownerProviderConfirmed: true,
        hasActiveEligibleService: true,
        hasExplicitWeeklyHours: true,
        dateOverridesReviewed: true,
        bookingPoliciesConfirmed: true,
        notificationAccepted: true,
        sourceRevision: 'seed:1',
        launchTestSourceRevision: 'seed:1',
        subscriptionAccess: true,
        publishedIntent: true,
        firstActivatedAt: '2026-07-10T09:30:00.000Z',
        bookingReadiness: true
      }
      return {
        revision: 1,
        sourceRevision: facts.sourceRevision,
        policies: launchBookingPolicies,
        progress: deriveActivationProgress(facts),
        facts,
        firstActivatedAt: facts.firstActivatedAt,
        businessDetails: {
          publicName: 'Mara Booking Studio',
          slug: 'mara-booking-studio',
          country: 'RO',
          line1: 'Strada Lipscani 21',
          locality: 'București',
          postalCode: '030167',
          publicPhone: '+40 700 000 000',
          arrivalDirections: ''
        }
      }
    }),
  saveConfirmations: () =>
    Effect.flatMap(MerchantContext, () =>
      Effect.fail(
        new CapabilityUnavailable({
          capability: 'merchant-activation',
          reason: 'Seed activation is immutable.'
        })
      )
    ),
  saveBusinessDetails: () =>
    Effect.flatMap(MerchantContext, () =>
      Effect.fail(
        new CapabilityUnavailable({
          capability: 'merchant-activation',
          reason: 'Seed activation is immutable.'
        })
      )
    ),
  runLaunchTest: (input) =>
    Effect.flatMap(MerchantContext, () =>
      simulateLaunchTest('seed:1', input, [input.startsAt])
    ),
  publish: () =>
    Effect.map(MerchantContext, () => ({
      status: 'published' as const,
      firstActivatedAt: '2026-07-10T09:30:00.000Z'
    }))
})

type RawActivationFacts = {
  business_details_complete: number
  owner_provider_confirmed: number
  active_eligible_service: number
  explicit_weekly_hours: number
  exception_reviewed: number
  policies_confirmed: number
  notification_accepted: number
  source_revision: string
  launch_test_source_revision: string | null
  subscription_access: number
  published_intent: number
  first_activated_at: string | null
  revision: number
  booking_policies_json: string | null
  booking_readiness: number
  public_name: string
  slug: string
  address_json: string | null
}

const activationFactsSql = `
SELECT
  m.public_name, m.slug, sa.address_json,
  CASE WHEN mas.business_details_confirmed_at IS NOT NULL
    AND length(trim(m.public_name)) > 0 AND length(trim(m.slug)) > 0
    AND sh.id IS NOT NULL AND sa.id IS NOT NULL
    AND json_extract(sa.address_json, '$.country') IS NOT NULL
    AND COALESCE(json_extract(sa.address_json, '$.line1'), json_extract(sa.address_json, '$.street')) IS NOT NULL
    AND COALESCE(json_extract(sa.address_json, '$.locality'), json_extract(sa.address_json, '$.city')) IS NOT NULL
    AND json_extract(sa.address_json, '$.postalCode') IS NOT NULL
    AND COALESCE(json_extract(sa.address_json, '$.publicPhone'), json_extract(sa.address_json, '$.phone')) IS NOT NULL
    AND length(trim(sh.timezone)) > 0 THEN 1 ELSE 0 END AS business_details_complete,
  CASE WHEN mas.owner_provider_confirmed_at IS NOT NULL AND EXISTS (
    SELECT 1 FROM providers p WHERE p.merchant_id = m.id AND p.is_default = 1
      AND p.status = 'active' AND length(trim(p.display_name)) > 0
  ) THEN 1 ELSE 0 END AS owner_provider_confirmed,
  CASE WHEN EXISTS (
    SELECT 1 FROM services s JOIN provider_service_eligibility pse
      ON pse.service_id = s.id AND pse.merchant_id = s.merchant_id
    JOIN providers p ON p.id = pse.provider_id AND p.merchant_id = s.merchant_id
    WHERE s.merchant_id = m.id AND s.status = 'active' AND p.status = 'active'
      AND p.is_default = 1
  ) THEN 1 ELSE 0 END AS active_eligible_service,
  CASE WHEN EXISTS (SELECT 1 FROM schedule_rules sr WHERE sr.merchant_id = m.id)
    THEN 1 ELSE 0 END AS explicit_weekly_hours,
  CASE WHEN mas.exception_review_confirmed_at IS NOT NULL THEN 1 ELSE 0 END AS exception_reviewed,
  CASE WHEN mas.policies_confirmed_at IS NOT NULL AND mas.booking_policies_json IS NOT NULL
    THEN 1 ELSE 0 END AS policies_confirmed,
  CASE WHEN EXISTS (SELECT 1 FROM transactional_email_evidence tee
    WHERE tee.merchant_id = m.id AND tee.purpose = 'owner_activation_test'
      AND tee.status IN ('captured','accepted','delivered')) THEN 1 ELSE 0 END AS notification_accepted,
  m.updated_at || '|' || COALESCE(sh.updated_at,'') || '|' || COALESCE(sa.updated_at,'') || '|' ||
    COALESCE((SELECT max(updated_at) FROM providers WHERE merchant_id=m.id),'') || '|' ||
    COALESCE((SELECT max(updated_at) FROM services WHERE merchant_id=m.id),'') || '|' ||
    COALESCE((SELECT max(updated_at) FROM schedule_rules WHERE merchant_id=m.id),'') || '|' ||
    COALESCE((SELECT max(updated_at) FROM schedule_exceptions WHERE merchant_id=m.id),'') || '|' ||
    COALESCE((SELECT max(updated_at) FROM blocked_times WHERE merchant_id=m.id),'') || '|' ||
    COALESCE(mas.business_details_confirmed_at,'') || '|' ||
    COALESCE(mas.owner_provider_confirmed_at,'') || '|' ||
    COALESCE(mas.exception_review_confirmed_at,'') || '|' ||
    COALESCE(mas.policies_confirmed_at,'') || '|' || COALESCE(mas.booking_policies_json,'')
    AS source_revision,
  mas.launch_test_source_revision,
  CASE WHEN ms.status IN ('trialing','active','grace') THEN 1 ELSE 0 END
    AS subscription_access,
  CASE WHEN pbp.status = 'published' THEN 1 ELSE 0 END AS published_intent,
  mas.first_activated_at,
  mas.revision,
  mas.booking_policies_json,
  CASE WHEN length(trim(m.public_name)) > 0 AND length(trim(m.slug)) > 0
    AND EXISTS (SELECT 1 FROM services s JOIN provider_service_eligibility pse
      ON pse.service_id=s.id JOIN providers p ON p.id=pse.provider_id
      WHERE s.merchant_id=m.id AND s.status='active' AND p.status='active')
    AND EXISTS (SELECT 1 FROM schedule_rules sr JOIN providers p ON p.id=sr.provider_id
      WHERE sr.merchant_id=m.id AND p.status='active') THEN 1 ELSE 0 END AS booking_readiness
FROM merchants m
LEFT JOIN shops sh ON sh.merchant_id=m.id
LEFT JOIN shop_addresses sa ON sa.shop_id=sh.id
LEFT JOIN merchant_activation_states mas ON mas.merchant_id=m.id
LEFT JOIN public_booking_pages pbp ON pbp.merchant_id=m.id
LEFT JOIN merchant_subscriptions ms ON ms.merchant_id=m.id
WHERE m.id=? LIMIT 1`

const ensureActivationState = async (
  db: EffectDatabase,
  merchantId: string,
  now: string
) => {
  await db.$client.config.db
    .prepare(
      `INSERT INTO merchant_activation_states
       (merchant_id, booking_policies_json, revision, updated_at)
       VALUES (?, ?, 1, ?) ON CONFLICT(merchant_id) DO NOTHING`
    )
    .bind(merchantId, JSON.stringify(launchBookingPolicies), now)
    .run()
}

const readRawFacts = async (db: EffectDatabase, merchantId: string) => {
  const raw = db.$client.config.db
  await ensureActivationState(db, merchantId, new Date().toISOString())
  return raw.prepare(activationFactsSql).bind(merchantId).first<RawActivationFacts>()
}

const toFacts = (row: RawActivationFacts): ActivationFacts => ({
  businessDetailsComplete: row.business_details_complete === 1,
  ownerProviderConfirmed: row.owner_provider_confirmed === 1,
  hasActiveEligibleService: row.active_eligible_service === 1,
  hasExplicitWeeklyHours: row.explicit_weekly_hours === 1,
  dateOverridesReviewed: row.exception_reviewed === 1,
  bookingPoliciesConfirmed: row.policies_confirmed === 1,
  notificationAccepted: row.notification_accepted === 1,
  sourceRevision: row.source_revision,
  launchTestSourceRevision: row.launch_test_source_revision,
  subscriptionAccess: row.subscription_access === 1,
  publishedIntent: row.published_intent === 1,
  firstActivatedAt: row.first_activated_at,
  bookingReadiness: row.booking_readiness === 1
})

const toSnapshot = (row: RawActivationFacts): ActivationSnapshot => {
  const facts = toFacts(row)
  let policies = launchBookingPolicies
  if (row.booking_policies_json) {
    const decoded = Schema.decodeUnknownOption(BookingPolicies)(
      JSON.parse(row.booking_policies_json)
    )
    if (decoded._tag === 'Some') policies = decoded.value
  }
  const address = row.address_json
    ? (JSON.parse(row.address_json) as Record<string, unknown>)
    : {}
  const stringValue = (key: string, fallback = '') =>
    typeof address[key] === 'string' ? address[key] : fallback
  return {
    revision: row.revision,
    sourceRevision: row.source_revision,
    policies,
    progress: deriveActivationProgress(facts),
    facts,
    firstActivatedAt: row.first_activated_at,
    businessDetails: {
      publicName: row.public_name,
      slug: row.slug,
      country: stringValue('country'),
      line1: stringValue('line1', stringValue('street')),
      locality: stringValue('locality', stringValue('city')),
      postalCode: stringValue('postalCode'),
      publicPhone: stringValue('publicPhone', stringValue('phone')),
      arrivalDirections: stringValue('arrivalDirections')
    }
  }
}

const unavailable = (reason: unknown) =>
  new CapabilityUnavailable({
    capability: 'merchant-activation',
    reason: reason instanceof Error ? reason.message : String(reason)
  })

export const LiveMerchantActivation: Layer.Layer<MerchantActivation, never, Database> =
  Layer.effect(
    MerchantActivation,
    Effect.map(Database, (db) => ({
      read: () =>
        Effect.gen(function* () {
          const merchant = yield* MerchantContext
          const row = yield* Effect.tryPromise({
            try: () => readRawFacts(db, merchant.id),
            catch: unavailable
          })
          if (!row) return yield* Effect.fail(unavailable('Merchant not found.'))
          return toSnapshot(row)
        }),
      saveConfirmations: (input) =>
        Effect.gen(function* () {
          const merchant = yield* MerchantContext
          if (input.policies && !validateBookingPolicies(input.policies))
            return yield* Effect.fail(
              unavailable('Minimum Notice must be shorter than Booking Horizon.')
            )
          const now = new Date().toISOString()
          const result = yield* Effect.tryPromise({
            try: async () => {
              await ensureActivationState(db, merchant.id, now)
              return db.$client.config.db
                .prepare(
                  `UPDATE merchant_activation_states SET
                 business_details_confirmed_at=CASE WHEN ? IS NULL THEN business_details_confirmed_at WHEN ?=1 THEN ? ELSE NULL END,
                 owner_provider_confirmed_at=CASE WHEN ? IS NULL THEN owner_provider_confirmed_at WHEN ?=1 THEN ? ELSE NULL END,
                 exception_review_confirmed_at=CASE WHEN ? IS NULL THEN exception_review_confirmed_at WHEN ?=1 THEN ? ELSE NULL END,
                 booking_policies_json=COALESCE(?, booking_policies_json),
                 policies_confirmed_at=CASE WHEN ? IS NULL THEN policies_confirmed_at WHEN ?=1 THEN ? ELSE NULL END,
                 revision=revision+1, updated_at=? WHERE merchant_id=? AND revision=?`
                )
                .bind(
                  input.businessDetailsConfirmed ?? null,
                  input.businessDetailsConfirmed === true ? 1 : 0,
                  now,
                  input.ownerProviderConfirmed ?? null,
                  input.ownerProviderConfirmed === true ? 1 : 0,
                  now,
                  input.dateOverridesReviewed ?? null,
                  input.dateOverridesReviewed === true ? 1 : 0,
                  now,
                  input.policies ? JSON.stringify(input.policies) : null,
                  input.policiesConfirmed ?? null,
                  input.policiesConfirmed === true ? 1 : 0,
                  now,
                  now,
                  merchant.id,
                  input.expectedRevision
                )
                .run()
            },
            catch: unavailable
          })
          if ((result.meta.changes ?? 0) !== 1) {
            const current = yield* Effect.tryPromise({
              try: () => readRawFacts(db, merchant.id),
              catch: unavailable
            })
            return yield* Effect.fail(
              new ActivationRevisionConflict({
                currentRevision: current?.revision ?? 0
              })
            )
          }
          const row = yield* Effect.tryPromise({
            try: () => readRawFacts(db, merchant.id),
            catch: unavailable
          })
          if (!row) return yield* Effect.fail(unavailable('Merchant not found.'))
          return toSnapshot(row)
        }),
      saveBusinessDetails: (input) =>
        Effect.gen(function* () {
          const merchant = yield* MerchantContext
          const required = [
            input.publicName,
            input.slug,
            input.country,
            input.line1,
            input.locality,
            input.postalCode,
            input.publicPhone
          ]
          if (required.some((value) => !value.trim()))
            return yield* Effect.fail(
              unavailable('Every required Business Details field must be supplied.')
            )
          const now = new Date().toISOString()
          const address = JSON.stringify({
            country: input.country,
            line1: input.line1,
            locality: input.locality,
            postalCode: input.postalCode,
            publicPhone: input.publicPhone,
            ...(input.arrivalDirections
              ? { arrivalDirections: input.arrivalDirections }
              : {})
          })
          const results = yield* Effect.tryPromise({
            try: async () => {
              await ensureActivationState(db, merchant.id, now)
              return db.$client.config.db.batch([
                db.$client.config.db
                  .prepare(
                    `UPDATE merchants SET public_name=?,slug=?,updated_at=? WHERE id=? AND EXISTS
                 (SELECT 1 FROM merchant_activation_states WHERE merchant_id=? AND revision=?)`
                  )
                  .bind(
                    input.publicName,
                    input.slug,
                    now,
                    merchant.id,
                    merchant.id,
                    input.expectedRevision
                  ),
                db.$client.config.db
                  .prepare(
                    `UPDATE shops SET public_name=?,slug=?,updated_at=? WHERE merchant_id=? AND EXISTS
                 (SELECT 1 FROM merchant_activation_states WHERE merchant_id=? AND revision=?)`
                  )
                  .bind(
                    input.publicName,
                    input.slug,
                    now,
                    merchant.id,
                    merchant.id,
                    input.expectedRevision
                  ),
                db.$client.config.db
                  .prepare(
                    `INSERT INTO shop_addresses (id,shop_id,address_json,created_at,updated_at)
                 SELECT ?,sh.id,?,?,? FROM shops sh WHERE sh.merchant_id=? AND EXISTS
                 (SELECT 1 FROM merchant_activation_states WHERE merchant_id=? AND revision=?)
                 ON CONFLICT(shop_id) DO UPDATE SET address_json=excluded.address_json,updated_at=excluded.updated_at`
                  )
                  .bind(
                    newCapabilityId('sad'),
                    address,
                    now,
                    now,
                    merchant.id,
                    merchant.id,
                    input.expectedRevision
                  ),
                db.$client.config.db
                  .prepare(
                    `UPDATE merchant_activation_states SET business_details_confirmed_at=?,revision=revision+1,updated_at=?
                 WHERE merchant_id=? AND revision=?`
                  )
                  .bind(now, now, merchant.id, input.expectedRevision)
              ])
            },
            catch: unavailable
          })
          if ((results[3]?.meta.changes ?? 0) !== 1) {
            const current = yield* Effect.tryPromise({
              try: () => readRawFacts(db, merchant.id),
              catch: unavailable
            })
            return yield* Effect.fail(
              new ActivationRevisionConflict({
                currentRevision: current?.revision ?? 0
              })
            )
          }
          const row = yield* Effect.tryPromise({
            try: () => readRawFacts(db, merchant.id),
            catch: unavailable
          })
          if (!row) return yield* Effect.fail(unavailable('Merchant not found.'))
          return toSnapshot(row)
        }),
      runLaunchTest: (input) =>
        Effect.gen(function* () {
          const merchant = yield* MerchantContext
          const scheduling = yield* Scheduling
          const row = yield* Effect.tryPromise({
            try: () => readRawFacts(db, merchant.id),
            catch: unavailable
          })
          if (!row) return yield* Effect.fail(unavailable('Merchant not found.'))
          const availability = yield* scheduling.availability({
            providerId: input.providerId,
            serviceId: input.serviceId,
            from: new Date().toISOString(),
            days: toSnapshot(row).policies.bookingHorizonDays
          })
          const result = yield* simulateLaunchTest(
            row.source_revision,
            input,
            availability.slots.map((slot) => slot.startsAt)
          )
          const persisted = yield* Effect.tryPromise({
            try: async () => {
              const now = new Date().toISOString()
              return db.$client.config.db.batch([
                db.$client.config.db
                  .prepare(
                    `UPDATE merchant_activation_states SET launch_test_source_revision=?,
                 launch_test_passed_at=?, revision=revision+1, updated_at=?
                 WHERE merchant_id=? AND revision=?`
                  )
                  .bind(row.source_revision, now, now, merchant.id, row.revision),
                db.$client.config.db
                  .prepare(
                    `INSERT INTO merchant_activation_history
                 (id,merchant_id,kind,source_revision,occurred_at)
                 SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM merchant_activation_states
                   WHERE merchant_id=? AND launch_test_passed_at=?)`
                  )
                  .bind(
                    newCapabilityId('mah'),
                    merchant.id,
                    'launch_test_passed',
                    row.source_revision,
                    now,
                    merchant.id,
                    now
                  )
              ])
            },
            catch: unavailable
          })
          if ((persisted[0]?.meta.changes ?? 0) !== 1)
            return yield* Effect.fail(
              new LaunchTestRejected({ reason: 'slot_unavailable' })
            )
          return result
        }),
      publish: () =>
        Effect.gen(function* () {
          const merchant = yield* MerchantContext
          const row = yield* Effect.tryPromise({
            try: () => readRawFacts(db, merchant.id),
            catch: unavailable
          })
          if (!row) return yield* Effect.fail(unavailable('Merchant not found.'))
          if (row.first_activated_at) {
            if (!toFacts(row).bookingReadiness || row.subscription_access !== 1)
              return yield* Effect.fail(
                new ActivationNotReady({ incomplete: ['booking-readiness'] })
              )
            const updated = yield* Effect.tryPromise({
              try: () =>
                db.$client.config.db
                  .prepare(
                    `UPDATE public_booking_pages SET status='published',updated_at=?
                     WHERE merchant_id=? AND EXISTS (SELECT 1 FROM merchant_subscriptions
                       WHERE merchant_id=? AND status IN ('trialing','active','grace'))
                     AND EXISTS (SELECT 1 FROM services s JOIN provider_service_eligibility pse ON pse.service_id=s.id
                       JOIN providers p ON p.id=pse.provider_id WHERE s.merchant_id=? AND s.status='active' AND p.status='active')
                     AND EXISTS (SELECT 1 FROM schedule_rules WHERE merchant_id=?)`
                  )
                  .bind(
                    new Date().toISOString(),
                    merchant.id,
                    merchant.id,
                    merchant.id,
                    merchant.id
                  )
                  .run(),
              catch: unavailable
            })
            if ((updated.meta.changes ?? 0) !== 1)
              return yield* Effect.fail(
                new ActivationNotReady({ incomplete: ['booking-readiness'] })
              )
            return {
              status: 'published' as const,
              firstActivatedAt: row.first_activated_at
            }
          }
          const decision = decideFirstPublication(toFacts(row))
          if (decision.kind === 'reject')
            return yield* Effect.fail(
              new ActivationNotReady({ incomplete: [...decision.incomplete] })
            )
          const now = new Date().toISOString()
          const historyId = newCapabilityId('mah')
          const result = yield* Effect.tryPromise({
            try: async () =>
              db.$client.config.db.batch([
                db.$client.config.db
                  .prepare(
                    `UPDATE public_booking_pages SET status='published', updated_at=?
               WHERE merchant_id=? AND EXISTS (
                 SELECT 1 FROM merchant_activation_states mas
                 JOIN merchants m ON m.id=mas.merchant_id
                 JOIN shops sh ON sh.merchant_id=m.id
                 JOIN shop_addresses sa ON sa.shop_id=sh.id
                 WHERE mas.merchant_id=? AND mas.revision=?
                   AND mas.launch_test_source_revision=(
                     m.updated_at || '|' || COALESCE(sh.updated_at,'') || '|' || COALESCE(sa.updated_at,'') || '|' ||
                     COALESCE((SELECT max(updated_at) FROM providers WHERE merchant_id=m.id),'') || '|' ||
                     COALESCE((SELECT max(updated_at) FROM services WHERE merchant_id=m.id),'') || '|' ||
                     COALESCE((SELECT max(updated_at) FROM schedule_rules WHERE merchant_id=m.id),'') || '|' ||
                     COALESCE((SELECT max(updated_at) FROM schedule_exceptions WHERE merchant_id=m.id),'') || '|' ||
                     COALESCE((SELECT max(updated_at) FROM blocked_times WHERE merchant_id=m.id),'') || '|' ||
                     COALESCE(mas.business_details_confirmed_at,'') || '|' || COALESCE(mas.owner_provider_confirmed_at,'') || '|' ||
                     COALESCE(mas.exception_review_confirmed_at,'') || '|' || COALESCE(mas.policies_confirmed_at,'') || '|' ||
                     COALESCE(mas.booking_policies_json,''))
                   AND mas.business_details_confirmed_at IS NOT NULL
                   AND mas.owner_provider_confirmed_at IS NOT NULL
                   AND mas.exception_review_confirmed_at IS NOT NULL
                   AND mas.policies_confirmed_at IS NOT NULL
                   AND length(trim(m.public_name))>0 AND length(trim(m.slug))>0
                   AND json_extract(sa.address_json,'$.country') IS NOT NULL
                   AND COALESCE(json_extract(sa.address_json,'$.line1'),json_extract(sa.address_json,'$.street')) IS NOT NULL
                   AND COALESCE(json_extract(sa.address_json,'$.locality'),json_extract(sa.address_json,'$.city')) IS NOT NULL
                   AND json_extract(sa.address_json,'$.postalCode') IS NOT NULL
                   AND COALESCE(json_extract(sa.address_json,'$.publicPhone'),json_extract(sa.address_json,'$.phone')) IS NOT NULL
                   AND EXISTS (SELECT 1 FROM services s JOIN provider_service_eligibility pse ON pse.service_id=s.id
                     JOIN providers p ON p.id=pse.provider_id WHERE s.merchant_id=m.id AND s.status='active'
                       AND p.status='active' AND p.is_default=1)
                   AND EXISTS (SELECT 1 FROM schedule_rules sr WHERE sr.merchant_id=m.id)
                   AND EXISTS (SELECT 1 FROM transactional_email_evidence tee WHERE tee.merchant_id=m.id
                     AND tee.purpose='owner_activation_test' AND tee.status IN ('captured','accepted','delivered'))
               ) AND EXISTS (SELECT 1 FROM merchant_subscriptions ms WHERE ms.merchant_id=?
                 AND ms.status IN ('trialing','active','grace'))`
                  )
                  .bind(now, merchant.id, merchant.id, row.revision, merchant.id),
                db.$client.config.db
                  .prepare(
                    `UPDATE merchant_activation_states SET first_activated_at=COALESCE(first_activated_at,?),
               updated_at=? WHERE merchant_id=? AND revision=? AND EXISTS (
                 SELECT 1 FROM public_booking_pages pbp WHERE pbp.merchant_id=?
                   AND pbp.status='published' AND pbp.updated_at=?)`
                  )
                  .bind(now, now, merchant.id, row.revision, merchant.id, now),
                db.$client.config.db
                  .prepare(
                    `INSERT INTO merchant_activation_history (id,merchant_id,kind,source_revision,occurred_at)
               SELECT ?,?,?,?,? WHERE EXISTS (
                 SELECT 1 FROM public_booking_pages pbp WHERE pbp.merchant_id=?
                   AND pbp.status='published' AND pbp.updated_at=?) ON CONFLICT DO NOTHING`
                  )
                  .bind(
                    historyId,
                    merchant.id,
                    'first_published',
                    row.source_revision,
                    now,
                    merchant.id,
                    now
                  )
              ]),
            catch: unavailable
          })
          if ((result[0]?.meta.changes ?? 0) !== 1)
            return yield* Effect.fail(
              new ActivationNotReady({ incomplete: ['configuration-changed'] })
            )
          return {
            status: 'published' as const,
            firstActivatedAt: row.first_activated_at ?? now
          }
        })
    }))
  )
