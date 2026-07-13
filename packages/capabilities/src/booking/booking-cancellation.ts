import { Context, Effect, Layer, Schema } from 'effect'
import { CapabilityUnavailable } from '../errors.ts'

export type CancellationPolicySnapshot = {
  readonly id: string
  readonly version: number
  readonly cancellableUntilMinutesBeforeStart: number
}

export type RefundPolicySnapshot = {
  readonly id: string
  readonly version: number
  readonly refundableUntilMinutesBeforeStart: number
  readonly refundBasisPoints: number
}

export type RefundAllocation = {
  readonly tender: 'gift_card' | 'external_payment' | 'pay_in_person'
  readonly referenceId: string | null
  readonly amountMinor: number
}

export type CancellableAppointment = {
  readonly id: string
  readonly merchantId: string
  readonly bookingPartyId: string | null
  readonly status: 'scheduled' | 'completed' | 'cancelled' | 'no_show'
  readonly startsAt: string
  readonly totalMinor: number
  readonly currency: string
  readonly cancellationPolicy: CancellationPolicySnapshot
  readonly refundPolicy: RefundPolicySnapshot
  readonly settlementAllocations: readonly RefundAllocation[]
}

export type CancellationEvaluation = {
  readonly appointmentId: string
  readonly cancellation: {
    readonly eligible: boolean
    readonly policyId: string
    readonly policyVersion: number
  }
  readonly refund: {
    readonly entitled: boolean
    readonly amountMinor: number
    readonly currency: string
    readonly policyId: string
    readonly policyVersion: number
    readonly allocations: readonly RefundAllocation[]
  }
}

export type AppointmentLifecycleHistory = {
  readonly id: string
  readonly appointmentId: string
  readonly fromStatus: CancellableAppointment['status']
  readonly toStatus: CancellableAppointment['status']
  readonly reason: string
  readonly cancellationPolicyId: string
  readonly cancellationPolicyVersion: number
  readonly refundPolicyId: string
  readonly refundPolicyVersion: number
  readonly occurredAt: string
}

export type RefundObligation = {
  readonly id: string
  readonly appointmentId: string
  readonly bookingPartyId: string | null
  readonly status:
    | 'pending'
    | 'processing'
    | 'succeeded'
    | 'failed_retryable'
    | 'failed_terminal'
  readonly amountMinor: number
  readonly currency: string
  readonly allocations: readonly RefundAllocation[]
  readonly idempotencyKey: string
  readonly attemptCount: number
  readonly failureCode: string | null
  readonly providerEventId: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

export type CancellationResult = {
  readonly commandId: string
  readonly scope:
    | { readonly kind: 'appointment'; readonly appointmentId: string }
    | { readonly kind: 'party'; readonly bookingPartyId: string }
  readonly appointments: readonly CancellableAppointment[]
  readonly refundObligations: readonly RefundObligation[]
  readonly replayed: boolean
}

export class BookingCancellationRejected extends Schema.TaggedErrorClass<BookingCancellationRejected>()(
  'BookingCancellationRejected',
  {
    code: Schema.Literals([
      'appointment_not_found',
      'cancellation_ineligible',
      'idempotency_key_reused',
      'party_not_found',
      'refund_obligation_not_found',
      'refund_obligation_terminal'
    ])
  }
) {}

type CancellationError = BookingCancellationRejected | CapabilityUnavailable

export type BookingCancellationsShape = {
  readonly evaluate: (input: {
    readonly merchantId: string
    readonly appointmentId: string
    readonly now: string
  }) => Effect.Effect<CancellationEvaluation, CancellationError>
  readonly cancel: (input: {
    readonly merchantId: string
    readonly scope:
      | { readonly kind: 'appointment'; readonly appointmentId: string }
      | { readonly kind: 'party'; readonly bookingPartyId: string }
    readonly idempotencyKey: string
    readonly reason: string
    readonly now: string
  }) => Effect.Effect<CancellationResult, CancellationError>
  readonly recordRefundOutcome: (input: {
    readonly obligationId: string
    readonly providerEventId: string
    readonly outcome: 'succeeded' | 'failed_retryable' | 'failed_terminal'
    readonly failureCode?: string
    readonly now: string
  }) => Effect.Effect<RefundObligation, CancellationError>
}

export class BookingCancellations extends Context.Service<
  BookingCancellations,
  BookingCancellationsShape
>()('@b2b-saas-starter/capabilities/BookingCancellations') {}

export type SeedBookingCancellationStore = {
  readonly appointments: Map<string, CancellableAppointment>
  readonly history: AppointmentLifecycleHistory[]
  readonly refundObligations: RefundObligation[]
  readonly commands: Map<string, CancellationResult>
  readonly commandTargets: Map<string, string>
  readonly providerEvents: Map<string, string>
}

export const emptySeedBookingCancellationStore = (
  appointments: readonly CancellableAppointment[] = []
): SeedBookingCancellationStore => ({
  appointments: new Map(appointments.map((record) => [record.id, record])),
  history: [],
  refundObligations: [],
  commands: new Map(),
  commandTargets: new Map(),
  providerEvents: new Map()
})

const stableSuffix = (value: string) => {
  let hash = 2166136261
  for (const character of value)
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619)
  return (hash >>> 0).toString(36)
}

const minutesUntil = (startsAt: string, now: string) =>
  (Date.parse(startsAt) - Date.parse(now)) / 60_000

const allocateRefund = (
  allocations: readonly RefundAllocation[],
  amountMinor: number
): readonly RefundAllocation[] => {
  let remaining = amountMinor
  const result: RefundAllocation[] = []
  for (const allocation of allocations) {
    if (remaining <= 0) break
    const allocated = Math.min(allocation.amountMinor, remaining)
    if (allocated > 0) result.push({ ...allocation, amountMinor: allocated })
    remaining -= allocated
  }
  return result
}

export const evaluateCancellation = (
  appointment: CancellableAppointment,
  now: string
): CancellationEvaluation => {
  const leadMinutes = minutesUntil(appointment.startsAt, now)
  const eligible =
    appointment.status === 'scheduled' &&
    leadMinutes >= appointment.cancellationPolicy.cancellableUntilMinutesBeforeStart
  const entitled =
    leadMinutes >= appointment.refundPolicy.refundableUntilMinutesBeforeStart &&
    appointment.refundPolicy.refundBasisPoints > 0
  const refundableMinor = appointment.settlementAllocations
    .filter((allocation) => allocation.tender !== 'pay_in_person')
    .reduce((total, allocation) => total + allocation.amountMinor, 0)
  const amountMinor = entitled
    ? Math.min(
        refundableMinor,
        Math.floor(
          (appointment.totalMinor * appointment.refundPolicy.refundBasisPoints) / 10_000
        )
      )
    : 0
  return {
    appointmentId: appointment.id,
    cancellation: {
      eligible,
      policyId: appointment.cancellationPolicy.id,
      policyVersion: appointment.cancellationPolicy.version
    },
    refund: {
      entitled: amountMinor > 0,
      amountMinor,
      currency: appointment.currency,
      policyId: appointment.refundPolicy.id,
      policyVersion: appointment.refundPolicy.version,
      allocations: allocateRefund(appointment.settlementAllocations, amountMinor)
    }
  }
}

const targetKey = (scope: CancellationResult['scope']) =>
  scope.kind === 'appointment'
    ? `appointment:${scope.appointmentId}`
    : `party:${scope.bookingPartyId}`

export const SeedBookingCancellations = (
  store = emptySeedBookingCancellationStore()
): Layer.Layer<BookingCancellations> =>
  Layer.succeed(BookingCancellations)({
    evaluate: (input) => {
      const appointment = store.appointments.get(input.appointmentId)
      return !appointment || appointment.merchantId !== input.merchantId
        ? Effect.fail(
            new BookingCancellationRejected({ code: 'appointment_not_found' })
          )
        : Effect.succeed(evaluateCancellation(appointment, input.now))
    },
    cancel: (input) =>
      Effect.try({
        try: () => {
          const replay = store.commands.get(input.idempotencyKey)
          if (replay) {
            if (targetKey(replay.scope) !== targetKey(input.scope))
              throw new BookingCancellationRejected({
                code: 'idempotency_key_reused'
              })
            return { ...replay, replayed: true }
          }
          const scope = input.scope
          const records =
            scope.kind === 'appointment'
              ? [store.appointments.get(scope.appointmentId)].filter(
                  (record): record is CancellableAppointment => record !== undefined
                )
              : [...store.appointments.values()].filter(
                  (record) => record.bookingPartyId === scope.bookingPartyId
                )
          if (
            records.length === 0 ||
            records.some((record) => record.merchantId !== input.merchantId)
          )
            throw new BookingCancellationRejected({
              code:
                scope.kind === 'appointment'
                  ? 'appointment_not_found'
                  : 'party_not_found'
            })
          const evaluations = records.map((record) =>
            evaluateCancellation(record, input.now)
          )
          if (evaluations.some((evaluation) => !evaluation.cancellation.eligible))
            throw new BookingCancellationRejected({ code: 'cancellation_ineligible' })
          const existingTarget = store.commandTargets.get(targetKey(scope))
          if (existingTarget) return store.commands.get(existingTarget)!

          const cancelled = records.map((record) => ({
            ...record,
            status: 'cancelled' as const
          }))
          const obligations = evaluations.flatMap((evaluation, index) => {
            if (!evaluation.refund.entitled) return []
            const record = records[index]!
            return [
              {
                id: `rfo_${stableSuffix(`${input.idempotencyKey}:${record.id}`)}`,
                appointmentId: record.id,
                bookingPartyId: record.bookingPartyId,
                status: 'pending' as const,
                amountMinor: evaluation.refund.amountMinor,
                currency: evaluation.refund.currency,
                allocations: evaluation.refund.allocations,
                idempotencyKey: `refund:${record.id}`,
                attemptCount: 0,
                failureCode: null,
                providerEventId: null,
                createdAt: input.now,
                updatedAt: input.now
              }
            ]
          })
          for (let index = 0; index < records.length; index += 1) {
            const record = records[index]!
            const evaluation = evaluations[index]!
            store.appointments.set(record.id, cancelled[index]!)
            store.history.push({
              id: `alh_${stableSuffix(`${input.idempotencyKey}:${record.id}`)}`,
              appointmentId: record.id,
              fromStatus: record.status,
              toStatus: 'cancelled',
              reason: input.reason,
              cancellationPolicyId: evaluation.cancellation.policyId,
              cancellationPolicyVersion: evaluation.cancellation.policyVersion,
              refundPolicyId: evaluation.refund.policyId,
              refundPolicyVersion: evaluation.refund.policyVersion,
              occurredAt: input.now
            })
          }
          store.refundObligations.push(...obligations)
          const result: CancellationResult = {
            commandId: `ccm_${stableSuffix(input.idempotencyKey)}`,
            scope,
            appointments: cancelled,
            refundObligations: obligations,
            replayed: false
          }
          store.commands.set(input.idempotencyKey, result)
          store.commandTargets.set(targetKey(scope), input.idempotencyKey)
          return result
        },
        catch: (cause) =>
          cause instanceof BookingCancellationRejected
            ? cause
            : new CapabilityUnavailable({
                capability: 'booking-cancellations',
                reason: 'cancellation_failed'
              })
      }),
    recordRefundOutcome: (input) =>
      Effect.try({
        try: () => {
          const index = store.refundObligations.findIndex(
            (obligation) => obligation.id === input.obligationId
          )
          if (index < 0)
            throw new BookingCancellationRejected({
              code: 'refund_obligation_not_found'
            })
          const current = store.refundObligations[index]!
          const replayId = store.providerEvents.get(input.providerEventId)
          if (replayId) {
            if (replayId !== current.id)
              throw new BookingCancellationRejected({
                code: 'idempotency_key_reused'
              })
            return current
          }
          if (current.status === 'succeeded' || current.status === 'failed_terminal')
            throw new BookingCancellationRejected({
              code: 'refund_obligation_terminal'
            })
          const updated: RefundObligation = {
            ...current,
            status: input.outcome,
            attemptCount: current.attemptCount + 1,
            failureCode:
              input.outcome === 'succeeded' ? null : (input.failureCode ?? 'unknown'),
            providerEventId: input.providerEventId,
            updatedAt: input.now
          }
          store.refundObligations[index] = updated
          store.providerEvents.set(input.providerEventId, current.id)
          return updated
        },
        catch: (cause) =>
          cause instanceof BookingCancellationRejected
            ? cause
            : new CapabilityUnavailable({
                capability: 'booking-cancellations',
                reason: 'refund_outcome_failed'
              })
      })
  })
