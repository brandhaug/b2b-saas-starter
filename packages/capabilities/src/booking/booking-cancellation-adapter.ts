import { Effect, Layer } from 'effect'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import {
  appointmentCancellations,
  appointments,
  batch,
  cancellationCommands,
  Database,
  lifecycleHistory,
  notificationIntents,
  giftCardLedgerEntries,
  paymentTransactions,
  payments,
  refundObligationEvents,
  refundObligationAllocations,
  refundObligations,
  scheduledWork,
  settlementAllocations,
  type StoredAppointmentSnapshot
} from '@b2b-saas-starter/db'
import { CapabilityUnavailable } from '../errors.ts'
import { orUnavailable } from '../internal/unavailable.ts'
import {
  BookingCancellationRejected,
  BookingCancellations,
  evaluateCancellation,
  type CancellableAppointment,
  type CancellationResult,
  type RefundAllocation,
  type RefundObligation
} from './booking-cancellation.ts'

const stableSuffix = (value: string) => {
  let hash = 2166136261
  for (const character of value)
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619)
  return (hash >>> 0).toString(36)
}

const defaultCancellationPolicy = {
  id: 'cancellation:legacy:v1',
  version: 1,
  cancellableUntilMinutesBeforeStart: 60
} as const
const defaultRefundPolicy = {
  id: 'refund:legacy:v1',
  version: 1,
  refundableUntilMinutesBeforeStart: 24 * 60,
  refundBasisPoints: 10_000
} as const

const distributeAllocations = (
  records: readonly (typeof appointments.$inferSelect)[],
  partyAllocations: readonly (typeof settlementAllocations.$inferSelect)[]
): Map<string, readonly RefundAllocation[]> => {
  const result = new Map<string, readonly RefundAllocation[]>()
  let allocationIndex = 0
  let allocationUsed = 0
  for (const record of records) {
    const snapshot = record.snapshot as StoredAppointmentSnapshot
    let remaining = snapshot.totalMinor
    const allocated: RefundAllocation[] = []
    while (remaining > 0 && allocationIndex < partyAllocations.length) {
      const source = partyAllocations[allocationIndex]!
      const available = source.amountMinor - allocationUsed
      const amountMinor = Math.min(available, remaining)
      if (amountMinor > 0)
        allocated.push({
          tender: source.tender,
          referenceId: source.referenceId,
          amountMinor
        })
      remaining -= amountMinor
      allocationUsed += amountMinor
      if (allocationUsed === source.amountMinor) {
        allocationIndex += 1
        allocationUsed = 0
      }
    }
    if (remaining > 0)
      allocated.push({
        tender: 'pay_in_person',
        referenceId: null,
        amountMinor: remaining
      })
    result.set(record.id, allocated)
  }
  return result
}

export const LiveBookingCancellations: Layer.Layer<
  BookingCancellations,
  never,
  Database
> = Layer.effect(
  BookingCancellations,
  Effect.gen(function* () {
    const db = yield* Database
    const loadRecords = (input: {
      readonly merchantId: string
      readonly appointmentId?: string
      readonly bookingPartyId?: string
    }) =>
      Effect.gen(function* () {
        const rows = yield* orUnavailable('booking-cancellations')(
          db
            .select()
            .from(appointments)
            .where(
              and(
                eq(appointments.merchantId, input.merchantId),
                input.appointmentId
                  ? eq(appointments.id, input.appointmentId)
                  : eq(appointments.bookingPartyId, input.bookingPartyId!)
              )
            )
            .orderBy(asc(appointments.createdAt), asc(appointments.id))
        )
        if (rows.length === 0) return []
        const partyId = rows[0]?.bookingPartyId
        const allPartyRows = partyId
          ? yield* orUnavailable('booking-cancellations')(
              db
                .select()
                .from(appointments)
                .where(eq(appointments.bookingPartyId, partyId))
                .orderBy(asc(appointments.createdAt), asc(appointments.id))
            )
          : rows
        const allocations = partyId
          ? yield* orUnavailable('booking-cancellations')(
              db
                .select()
                .from(settlementAllocations)
                .where(eq(settlementAllocations.bookingPartyId, partyId))
                .orderBy(
                  asc(settlementAllocations.createdAt),
                  asc(settlementAllocations.id)
                )
            )
          : []
        const distributed = distributeAllocations(allPartyRows, allocations)
        return rows.flatMap((row): CancellableAppointment[] => {
          if (!row.snapshot) return []
          const snapshot = row.snapshot as StoredAppointmentSnapshot
          return [
            {
              id: row.id,
              merchantId: row.merchantId,
              bookingPartyId: row.bookingPartyId,
              status: row.status,
              version: row.version,
              startsAt: row.startsAt,
              totalMinor: snapshot.totalMinor,
              currency: snapshot.currency,
              cancellationPolicy:
                snapshot.cancellationPolicy ?? defaultCancellationPolicy,
              refundPolicy: snapshot.refundPolicy ?? defaultRefundPolicy,
              settlementAllocations: distributed.get(row.id) ?? []
            }
          ]
        })
      })

    const readObligations = (ids: readonly string[]) =>
      Effect.gen(function* () {
        if (ids.length === 0) return []
        const rows = yield* orUnavailable('booking-cancellations')(
          db.select().from(refundObligations).where(inArray(refundObligations.id, ids))
        )
        const allocations = yield* orUnavailable('booking-cancellations')(
          db
            .select()
            .from(refundObligationAllocations)
            .where(inArray(refundObligationAllocations.refundObligationId, ids))
            .orderBy(asc(refundObligationAllocations.position))
        )
        return rows.map(
          (row): RefundObligation => ({
            id: row.id,
            appointmentId: row.appointmentId,
            bookingPartyId: row.bookingPartyId,
            status: row.status,
            amountMinor: row.amountMinor,
            currency: row.currency,
            allocations: allocations
              .filter((allocation) => allocation.refundObligationId === row.id)
              .map(({ tender, referenceId, amountMinor }) => ({
                tender,
                referenceId,
                amountMinor
              })),
            idempotencyKey: row.idempotencyKey,
            attemptCount: row.attemptCount,
            failureCode: row.failureCode,
            providerEventId: row.providerEventId,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt
          })
        )
      })

    const readCommand = (command: typeof cancellationCommands.$inferSelect) =>
      Effect.gen(function* () {
        const result = command.resultJson
        if (!result)
          return yield* new CapabilityUnavailable({
            capability: 'booking-cancellations',
            reason: 'cancellation_result_missing'
          })
        const records = yield* loadRecords({
          merchantId: command.merchantId,
          ...(command.scope === 'appointment'
            ? { appointmentId: command.targetId }
            : { bookingPartyId: command.targetId })
        })
        const obligations = yield* readObligations(result.refundObligationIds)
        return {
          commandId: command.id,
          scope:
            command.scope === 'appointment'
              ? ({ kind: 'appointment', appointmentId: command.targetId } as const)
              : ({ kind: 'party', bookingPartyId: command.targetId } as const),
          appointments: records,
          refundObligations: obligations,
          replayed: true
        } satisfies CancellationResult
      })

    return {
      evaluate: (input) =>
        Effect.gen(function* () {
          const [record] = yield* loadRecords({
            merchantId: input.merchantId,
            appointmentId: input.appointmentId
          })
          return record
            ? evaluateCancellation(record, input.now)
            : yield* new BookingCancellationRejected({
                code: 'appointment_not_found'
              })
        }),
      cancel: (input) =>
        Effect.gen(function* () {
          const [replay] = yield* orUnavailable('booking-cancellations')(
            db
              .select()
              .from(cancellationCommands)
              .where(
                and(
                  eq(cancellationCommands.merchantId, input.merchantId),
                  eq(cancellationCommands.idempotencyKey, input.idempotencyKey)
                )
              )
              .limit(1)
          )
          const scope = input.scope
          const targetId =
            scope.kind === 'appointment' ? scope.appointmentId : scope.bookingPartyId
          if (replay) {
            if (replay.scope !== scope.kind || replay.targetId !== targetId)
              return yield* new BookingCancellationRejected({
                code: 'idempotency_key_reused'
              })
            return yield* readCommand(replay)
          }
          const [existing] = yield* orUnavailable('booking-cancellations')(
            db
              .select()
              .from(cancellationCommands)
              .where(
                and(
                  eq(cancellationCommands.merchantId, input.merchantId),
                  eq(cancellationCommands.scope, scope.kind),
                  eq(cancellationCommands.targetId, targetId)
                )
              )
              .limit(1)
          )
          if (existing) return yield* readCommand(existing)
          const records = yield* loadRecords({
            merchantId: input.merchantId,
            ...(scope.kind === 'appointment'
              ? { appointmentId: scope.appointmentId }
              : { bookingPartyId: scope.bookingPartyId })
          })
          if (records.length === 0)
            return yield* new BookingCancellationRejected({
              code:
                scope.kind === 'appointment'
                  ? 'appointment_not_found'
                  : 'party_not_found'
            })
          const evaluations = records.map((record) =>
            evaluateCancellation(record, input.now)
          )
          if (evaluations.some((evaluation) => !evaluation.cancellation.eligible))
            return yield* new BookingCancellationRejected({
              code: 'cancellation_ineligible'
            })
          const commandId = `ccm_${stableSuffix(`${input.merchantId}:${input.idempotencyKey}`)}`
          const obligationRows = evaluations.flatMap((evaluation, index) =>
            evaluation.refund.entitled
              ? [
                  {
                    id: `rfo_${stableSuffix(`${input.idempotencyKey}:${records[index]!.id}`)}`,
                    appointmentId: records[index]!.id,
                    bookingPartyId: records[index]!.bookingPartyId,
                    amountMinor: evaluation.refund.amountMinor,
                    currency: evaluation.refund.currency,
                    idempotencyKey: `refund:${records[index]!.id}`,
                    createdAt: input.now,
                    updatedAt: input.now,
                    allocations: evaluation.refund.allocations
                  }
                ]
              : []
          )
          const concurrentCommand = yield* orUnavailable('booking-cancellations')(
            batch(db, [
              db.insert(cancellationCommands).values({
                id: commandId,
                merchantId: input.merchantId,
                scope: scope.kind,
                targetId,
                idempotencyKey: input.idempotencyKey,
                resultJson: {
                  appointmentIds: records.map((record) => record.id),
                  refundObligationIds: obligationRows.map((row) => row.id)
                },
                createdAt: input.now
              }),
              ...records.flatMap((record, index) => {
                const evaluation = evaluations[index]!
                return [
                  db.insert(appointmentCancellations).values({
                    id: `acn_${stableSuffix(`${input.idempotencyKey}:${record.id}`)}`,
                    appointmentId: record.id,
                    commandId,
                    appointmentVersion: record.version,
                    reasonCode: input.reason,
                    cancellationPolicyId: evaluation.cancellation.policyId,
                    cancellationPolicyVersion: evaluation.cancellation.policyVersion,
                    refundPolicyId: evaluation.refund.policyId,
                    refundPolicyVersion: evaluation.refund.policyVersion,
                    cancelledAt: input.now,
                    createdAt: input.now
                  }),
                  db.insert(lifecycleHistory).values({
                    id: `alh_${stableSuffix(`${input.idempotencyKey}:${record.id}`)}`,
                    aggregateType: 'appointment',
                    aggregateId: record.id,
                    fromState: 'scheduled',
                    toState: 'cancelled',
                    reasonCode: input.reason,
                    factsJson: JSON.stringify({
                      cancellationPolicyId: evaluation.cancellation.policyId,
                      cancellationPolicyVersion: evaluation.cancellation.policyVersion,
                      refundPolicyId: evaluation.refund.policyId,
                      refundPolicyVersion: evaluation.refund.policyVersion
                    }),
                    occurredAt: input.now,
                    createdAt: input.now
                  }),
                  db
                    .update(appointments)
                    .set({
                      status: 'cancelled',
                      version: record.version + 1,
                      updatedAt: input.now
                    })
                    .where(
                      and(
                        eq(appointments.id, record.id),
                        eq(appointments.status, 'scheduled'),
                        eq(appointments.version, record.version)
                      )
                    ),
                  db
                    .update(notificationIntents)
                    .set({ status: 'cancelled', updatedAt: input.now })
                    .where(
                      and(
                        eq(notificationIntents.sourceType, 'appointment'),
                        eq(notificationIntents.sourceId, record.id),
                        inArray(notificationIntents.status, [
                          'pending',
                          'processing',
                          'failed'
                        ])
                      )
                    ),
                  db
                    .update(scheduledWork)
                    .set({ status: 'cancelled', updatedAt: input.now })
                    .where(
                      and(
                        eq(scheduledWork.sourceType, 'appointment'),
                        eq(scheduledWork.sourceId, record.id),
                        inArray(scheduledWork.status, ['pending', 'running', 'failed'])
                      )
                    )
                ]
              }),
              ...obligationRows.flatMap((row) => [
                db.insert(refundObligations).values({
                  id: row.id,
                  appointmentId: row.appointmentId,
                  bookingPartyId: row.bookingPartyId,
                  amountMinor: row.amountMinor,
                  currency: row.currency,
                  idempotencyKey: row.idempotencyKey,
                  createdAt: row.createdAt,
                  updatedAt: row.updatedAt
                }),
                ...row.allocations.map((allocation, position) =>
                  db.insert(refundObligationAllocations).values({
                    refundObligationId: row.id,
                    position,
                    ...allocation
                  })
                )
              ])
            ])
          ).pipe(
            Effect.as(null),
            Effect.catchTag('CapabilityUnavailable', (error) =>
              Effect.gen(function* () {
                const [command] = yield* orUnavailable('booking-cancellations')(
                  db
                    .select()
                    .from(cancellationCommands)
                    .where(
                      and(
                        eq(cancellationCommands.merchantId, input.merchantId),
                        eq(cancellationCommands.scope, scope.kind),
                        eq(cancellationCommands.targetId, targetId)
                      )
                    )
                    .limit(1)
                )
                if (command) return command
                return yield* error
              })
            )
          )
          if (concurrentCommand) return yield* readCommand(concurrentCommand)
          const [stored] = yield* orUnavailable('booking-cancellations')(
            db
              .select()
              .from(cancellationCommands)
              .where(eq(cancellationCommands.id, commandId))
              .limit(1)
          )
          if (!stored)
            return yield* new CapabilityUnavailable({
              capability: 'booking-cancellations',
              reason: 'cancellation_commit_missing'
            })
          const result = yield* readCommand(stored)
          return { ...result, replayed: false }
        }),
      recordRefundOutcome: (input) =>
        Effect.gen(function* () {
          const [eventReplay] = yield* orUnavailable('booking-cancellations')(
            db
              .select()
              .from(refundObligationEvents)
              .where(eq(refundObligationEvents.providerEventId, input.providerEventId))
              .limit(1)
          )
          if (eventReplay) {
            if (eventReplay.refundObligationId !== input.obligationId)
              return yield* new BookingCancellationRejected({
                code: 'idempotency_key_reused'
              })
            return (yield* readObligations([eventReplay.refundObligationId]))[0]!
          }
          const [current] = yield* orUnavailable('booking-cancellations')(
            db
              .select()
              .from(refundObligations)
              .where(eq(refundObligations.id, input.obligationId))
              .limit(1)
          )
          if (!current)
            return yield* new BookingCancellationRejected({
              code: 'refund_obligation_not_found'
            })
          if (current.status === 'succeeded' || current.status === 'failed_terminal')
            return yield* new BookingCancellationRejected({
              code: 'refund_obligation_terminal'
            })
          const allocations = (yield* readObligations([current.id]))[0]!.allocations
          const external = allocations.filter(
            (allocation) => allocation.tender === 'external_payment'
          )
          const giftCards = allocations.filter(
            (allocation) => allocation.tender === 'gift_card'
          )
          const concurrentEvent = yield* orUnavailable('booking-cancellations')(
            batch(db, [
              db.insert(refundObligationEvents).values({
                id: `roe_${stableSuffix(input.providerEventId)}`,
                refundObligationId: current.id,
                providerEventId: input.providerEventId,
                outcome: input.outcome,
                failureCode:
                  input.outcome === 'succeeded'
                    ? null
                    : (input.failureCode ?? 'unknown'),
                expectedAttemptCount: current.attemptCount,
                occurredAt: input.now,
                createdAt: input.now
              }),
              ...(input.outcome === 'succeeded'
                ? [
                    ...external.map((allocation, index) =>
                      db
                        .insert(paymentTransactions)
                        .values({
                          id: `ptx_${stableSuffix(`${current.id}:external:${index}`)}`,
                          paymentId: allocation.referenceId!,
                          kind: 'refund' as const,
                          amountMinor: allocation.amountMinor,
                          currency: current.currency,
                          providerReference: `${input.providerEventId}:${index}`,
                          occurredAt: input.now,
                          createdAt: input.now
                        })
                        .onConflictDoNothing()
                    ),
                    ...external.map((allocation) =>
                      db
                        .update(payments)
                        .set({
                          refundedMinor: sql`${payments.refundedMinor} + ${allocation.amountMinor}`,
                          status: sql`CASE WHEN ${payments.refundedMinor} + ${allocation.amountMinor} >= ${payments.capturedMinor} THEN 'refunded' ELSE 'partially_refunded' END`,
                          updatedAt: input.now
                        })
                        .where(eq(payments.id, allocation.referenceId!))
                    ),
                    ...giftCards.map((allocation, index) =>
                      db
                        .insert(giftCardLedgerEntries)
                        .values({
                          id: `gcl_${stableSuffix(`${current.id}:gift-card:${index}`)}`,
                          giftCardId: allocation.referenceId!,
                          kind: 'refund' as const,
                          amountMinor: allocation.amountMinor,
                          bookingPartyId: current.bookingPartyId,
                          idempotencyKey: `refund-obligation:${current.id}:${index}`,
                          occurredAt: input.now,
                          createdAt: input.now
                        })
                        .onConflictDoNothing()
                    )
                  ]
                : []),
              db
                .update(refundObligations)
                .set({
                  status: input.outcome,
                  attemptCount: current.attemptCount + 1,
                  failureCode:
                    input.outcome === 'succeeded'
                      ? null
                      : (input.failureCode ?? 'unknown'),
                  providerEventId: input.providerEventId,
                  updatedAt: input.now
                })
                .where(eq(refundObligations.id, current.id))
            ])
          ).pipe(
            Effect.as(false),
            Effect.catchTag('CapabilityUnavailable', (error) =>
              Effect.gen(function* () {
                const [event] = yield* orUnavailable('booking-cancellations')(
                  db
                    .select()
                    .from(refundObligationEvents)
                    .where(
                      eq(refundObligationEvents.providerEventId, input.providerEventId)
                    )
                    .limit(1)
                )
                if (event?.refundObligationId === input.obligationId) return true
                return yield* error
              })
            )
          )
          if (concurrentEvent) return (yield* readObligations([input.obligationId]))[0]!
          return (yield* readObligations([current.id]))[0]!
        })
    }
  })
)
