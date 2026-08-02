import { Effect, Schema } from 'effect'

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
    'launch-test': facts.launchTestSourceRevision === facts.sourceRevision,
    publication: facts.firstActivatedAt !== null
  }
  const complete = activationSteps.filter((step) => checks[step])
  const incomplete = activationSteps.filter((step) => !checks[step])
  const activationRequirements = activationSteps.slice(0, -1)
  const readyForFirstPublication = activationRequirements.every((step) => checks[step])
  return {
    complete,
    incomplete,
    resumeAt: incomplete[0] ?? null,
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
