import { Effect, Layer } from 'effect'
import { and, eq, gt, inArray, lt, ne } from 'drizzle-orm'
import {
  appointments,
  batch,
  bookingParties,
  bookingSessions,
  checkoutPolicies,
  Database,
  lifecycleHistory,
  notificationIntents,
  payments,
  policyAcceptances,
  pricingQuoteAcceptances,
  pricingQuotes,
  providers,
  refundObligations,
  rescheduleCommands,
  rescheduleSessions,
  scheduledWork,
  timeSlotHolds,
  type StoredAppointmentSnapshot
} from '@b2b-saas-starter/db'
import { CapabilityUnavailable } from '../errors.ts'
import { orUnavailable } from '../internal/unavailable.ts'
import {
  BookingRescheduleRejected,
  BookingRescheduling,
  validateRescheduleReplacement,
  type ReschedulableAppointment,
  type RescheduleReplacement,
  type RescheduleResult,
  type RescheduleSession
} from './booking-rescheduling.ts'

const stableSuffix = (value: string) => {
  let hash = 2166136261
  for (const character of value)
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619)
  return (hash >>> 0).toString(36)
}

const rejected = (
  code: ConstructorParameters<typeof BookingRescheduleRejected>[0]['code']
) => new BookingRescheduleRejected({ code })

const mapAppointment = (
  row: typeof appointments.$inferSelect,
  shopId: string
): ReschedulableAppointment | null => {
  if (!row.snapshot) return null
  const snapshot = row.snapshot as StoredAppointmentSnapshot
  return {
    id: row.id,
    merchantId: row.merchantId,
    shopId,
    status: row.status,
    version: row.version,
    providerId: row.providerId,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    snapshot
  }
}

const mapReplacement = (
  row: typeof rescheduleSessions.$inferSelect,
  providerDisplayName: string | null
): RescheduleReplacement | null => {
  if (
    !row.holdId ||
    !row.replacementProviderId ||
    !providerDisplayName ||
    !row.replacementStartsAt ||
    !row.replacementEndsAt ||
    !row.holdExpiresAt ||
    !row.pricingQuoteId ||
    row.pricingQuoteVersion === null ||
    row.replacementTotalMinor === null ||
    !row.replacementCurrency ||
    !row.quoteAcceptedAt ||
    !row.quoteExpiresAt ||
    !row.policyId ||
    row.policyVersion === null ||
    !row.policyDisclosureSnapshot ||
    !row.policyAcceptedAt ||
    !row.settlementKind ||
    row.settlementAmountMinor === null
  )
    return null
  return {
    hold: {
      id: row.holdId,
      providerId: row.replacementProviderId,
      providerDisplayName,
      startsAt: row.replacementStartsAt,
      endsAt: row.replacementEndsAt,
      expiresAt: row.holdExpiresAt
    },
    quote: {
      id: row.pricingQuoteId,
      version: row.pricingQuoteVersion,
      totalMinor: row.replacementTotalMinor,
      currency: row.replacementCurrency,
      acceptedAt: row.quoteAcceptedAt,
      expiresAt: row.quoteExpiresAt
    },
    policyAcceptance: {
      policyId: row.policyId,
      policyVersion: row.policyVersion,
      disclosureSnapshot: row.policyDisclosureSnapshot,
      acceptedAt: row.policyAcceptedAt
    },
    settlement: {
      kind: row.settlementKind,
      amountMinor: row.settlementAmountMinor,
      referenceId: row.settlementReferenceId
    },
    reminderAt: row.reminderAt
  }
}

export const LiveBookingRescheduling: Layer.Layer<
  BookingRescheduling,
  never,
  Database
> = Layer.effect(
  BookingRescheduling,
  Effect.gen(function* () {
    const db = yield* Database

    const readAppointment = (merchantId: string, appointmentId: string) =>
      Effect.gen(function* () {
        const [record] = yield* orUnavailable('booking-rescheduling')(
          db
            .select({ appointment: appointments, party: bookingParties })
            .from(appointments)
            .leftJoin(
              bookingParties,
              eq(bookingParties.id, appointments.bookingPartyId)
            )
            .where(
              and(
                eq(appointments.id, appointmentId),
                eq(appointments.merchantId, merchantId)
              )
            )
            .limit(1)
        )
        if (!record?.party) return yield* rejected('appointment_not_found')
        const appointment = mapAppointment(record.appointment, record.party.shopId)
        if (!appointment) return yield* rejected('appointment_not_found')
        return appointment
      })

    const readSession = (sessionId: string, capabilityHash?: string) =>
      Effect.gen(function* () {
        const [record] = yield* orUnavailable('booking-rescheduling')(
          db
            .select({ session: rescheduleSessions, provider: providers })
            .from(rescheduleSessions)
            .leftJoin(
              providers,
              eq(providers.id, rescheduleSessions.replacementProviderId)
            )
            .where(
              and(
                eq(rescheduleSessions.id, sessionId),
                ...(capabilityHash
                  ? [eq(rescheduleSessions.capabilityHash, capabilityHash)]
                  : [])
              )
            )
            .limit(1)
        )
        if (!record) return yield* rejected('session_not_found')
        const row = record.session
        const session: RescheduleSession = {
          id: row.id,
          appointmentId: row.appointmentId,
          merchantId: row.merchantId,
          bookingSessionId: row.bookingSessionId,
          bookingPartyId: row.bookingPartyId,
          purpose: row.purpose,
          baseAppointmentVersion: row.baseAppointmentVersion,
          status: row.status,
          expiresAt: row.expiresAt,
          replacement: mapReplacement(row, record.provider?.displayName ?? null),
          committedAt: row.committedAt
        }
        return session
      })

    const hasSlotConflict = (
      appointmentId: string,
      replacement: RescheduleReplacement
    ) =>
      orUnavailable('booking-rescheduling')(
        db
          .select({ id: appointments.id })
          .from(appointments)
          .where(
            and(
              ne(appointments.id, appointmentId),
              eq(appointments.status, 'scheduled'),
              eq(appointments.providerId, replacement.hold.providerId),
              lt(appointments.startsAt, replacement.hold.endsAt),
              gt(appointments.endsAt, replacement.hold.startsAt)
            )
          )
          .limit(1)
      ).pipe(Effect.map((rows) => rows.length > 0))

    const verifyDurableReplacement = (
      session: RescheduleSession,
      appointment: ReschedulableAppointment,
      replacement: RescheduleReplacement
    ) =>
      Effect.gen(function* () {
        const [hold] = yield* orUnavailable('booking-rescheduling')(
          db
            .select({ hold: timeSlotHolds, provider: providers })
            .from(timeSlotHolds)
            .innerJoin(providers, eq(providers.id, timeSlotHolds.providerId))
            .where(
              and(
                eq(timeSlotHolds.id, replacement.hold.id),
                eq(timeSlotHolds.bookingSessionId, session.bookingSessionId),
                eq(timeSlotHolds.merchantId, session.merchantId)
              )
            )
            .limit(1)
        )
        if (
          !hold ||
          hold.hold.providerId !== replacement.hold.providerId ||
          hold.provider.displayName !== replacement.hold.providerDisplayName ||
          hold.hold.startsAt !== replacement.hold.startsAt ||
          hold.hold.endsAt !== replacement.hold.endsAt ||
          hold.hold.expiresAt !== replacement.hold.expiresAt ||
          hold.hold.quote.totalMinor !== replacement.quote.totalMinor ||
          hold.hold.quote.currency !== replacement.quote.currency
        )
          return yield* rejected('replacement_not_ready')

        const [quote] = yield* orUnavailable('booking-rescheduling')(
          db
            .select({ quote: pricingQuotes, acceptance: pricingQuoteAcceptances })
            .from(pricingQuotes)
            .innerJoin(
              pricingQuoteAcceptances,
              eq(pricingQuoteAcceptances.pricingQuoteId, pricingQuotes.id)
            )
            .where(
              and(
                eq(pricingQuotes.id, replacement.quote.id),
                eq(pricingQuotes.bookingPartyId, session.bookingPartyId),
                eq(pricingQuoteAcceptances.bookingPartyId, session.bookingPartyId)
              )
            )
            .limit(1)
        )
        if (
          !quote ||
          quote.quote.version !== replacement.quote.version ||
          quote.quote.totalMinor !== replacement.quote.totalMinor ||
          quote.quote.currency !== replacement.quote.currency ||
          quote.quote.acceptedAt !== replacement.quote.acceptedAt ||
          quote.quote.expiresAt !== replacement.quote.expiresAt
        )
          return yield* rejected('quote_invalid')

        const [policy] = yield* orUnavailable('booking-rescheduling')(
          db
            .select({ acceptance: policyAcceptances, policy: checkoutPolicies })
            .from(policyAcceptances)
            .innerJoin(
              checkoutPolicies,
              eq(checkoutPolicies.id, policyAcceptances.checkoutPolicyId)
            )
            .where(
              and(
                eq(policyAcceptances.bookingPartyId, session.bookingPartyId),
                eq(
                  policyAcceptances.checkoutPolicyId,
                  replacement.policyAcceptance.policyId
                )
              )
            )
            .limit(1)
        )
        if (
          !policy ||
          policy.policy.version !== replacement.policyAcceptance.policyVersion ||
          policy.acceptance.disclosureSnapshot !==
            replacement.policyAcceptance.disclosureSnapshot ||
          policy.acceptance.acceptedAt !== replacement.policyAcceptance.acceptedAt
        )
          return yield* rejected('policy_required')

        if (replacement.settlement.kind === 'additional_collection') {
          const [payment] = yield* orUnavailable('booking-rescheduling')(
            db
              .select()
              .from(payments)
              .where(
                and(
                  eq(payments.id, replacement.settlement.referenceId!),
                  eq(payments.bookingPartyId, session.bookingPartyId),
                  eq(payments.currency, replacement.quote.currency)
                )
              )
              .limit(1)
          )
          if (
            !payment ||
            payment.status !== 'captured' ||
            payment.capturedMinor < replacement.settlement.amountMinor
          )
            return yield* rejected('settlement_mismatch')
        } else if (replacement.settlement.kind === 'refund') {
          const [obligation] = yield* orUnavailable('booking-rescheduling')(
            db
              .select()
              .from(refundObligations)
              .where(eq(refundObligations.id, replacement.settlement.referenceId!))
              .limit(1)
          )
          if (
            obligation &&
            (obligation.appointmentId !== appointment.id ||
              obligation.currency !== replacement.quote.currency ||
              obligation.amountMinor !== replacement.settlement.amountMinor ||
              !['pending', 'failed_retryable'].includes(obligation.status))
          )
            return yield* rejected('settlement_mismatch')
        }
      })

    const readResult = (
      command: typeof rescheduleCommands.$inferSelect,
      replayed: boolean
    ) =>
      Effect.gen(function* () {
        const appointment = yield* readAppointment(
          command.merchantId,
          command.appointmentId
        )
        return {
          commandId: command.id,
          sessionId: command.rescheduleSessionId,
          appointment,
          fromVersion: command.fromVersion,
          toVersion: command.toVersion,
          replayed
        } satisfies RescheduleResult
      })

    return {
      begin: (input) =>
        Effect.gen(function* () {
          const appointment = yield* readAppointment(
            input.merchantId,
            input.appointmentId
          )
          if (appointment.status !== 'scheduled')
            return yield* rejected('appointment_not_reschedulable')
          const id = `rsc_${stableSuffix(`${input.appointmentId}:${input.capabilityHash}`)}`
          const bookingSessionId = `bsn_${id}`
          const bookingPartyId = `bpt_${id}`
          yield* orUnavailable('booking-rescheduling')(
            batch(db, [
              db.insert(bookingSessions).values({
                id: bookingSessionId,
                merchantId: appointment.merchantId,
                capabilityHash: `reschedule:${input.capabilityHash}`,
                checkoutPath: 'pay_in_person',
                lifecycle: 'active',
                createdAt: input.now,
                lastActivityAt: input.now,
                idleExpiresAt: input.expiresAt,
                absoluteExpiresAt: input.expiresAt
              }),
              db.insert(bookingParties).values({
                id: bookingPartyId,
                bookingSessionId,
                shopId: appointment.shopId,
                lifecycle: 'active',
                currency: appointment.snapshot.currency,
                locale: 'en',
                version: 1,
                createdAt: input.now,
                updatedAt: input.now
              }),
              db.insert(rescheduleSessions).values({
                id,
                appointmentId: appointment.id,
                merchantId: appointment.merchantId,
                bookingSessionId,
                bookingPartyId,
                capabilityHash: input.capabilityHash,
                baseAppointmentVersion: appointment.version,
                expiresAt: input.expiresAt,
                createdAt: input.now,
                updatedAt: input.now
              })
            ])
          ).pipe(
            Effect.catchTag('CapabilityUnavailable', () =>
              readSession(id, input.capabilityHash).pipe(Effect.asVoid)
            )
          )
          return yield* readSession(id, input.capabilityHash)
        }),
      prepare: (input) =>
        Effect.gen(function* () {
          const session = yield* readSession(input.sessionId, input.capabilityHash)
          if (Date.parse(session.expiresAt) <= Date.parse(input.now)) {
            yield* orUnavailable('booking-rescheduling')(
              db
                .update(rescheduleSessions)
                .set({ status: 'expired', updatedAt: input.now })
                .where(
                  and(
                    eq(rescheduleSessions.id, session.id),
                    eq(rescheduleSessions.status, 'active')
                  )
                )
            )
            return yield* rejected('session_expired')
          }
          if (session.status !== 'active') return yield* rejected('session_not_active')
          const appointment = yield* readAppointment(
            session.merchantId,
            session.appointmentId
          )
          yield* Effect.try({
            try: () =>
              validateRescheduleReplacement(appointment, input.replacement, input.now),
            catch: (error) =>
              error instanceof BookingRescheduleRejected
                ? error
                : new CapabilityUnavailable({
                    capability: 'booking-rescheduling',
                    reason: 'replacement_validation_failed'
                  })
          })
          yield* verifyDurableReplacement(session, appointment, input.replacement)
          if (yield* hasSlotConflict(appointment.id, input.replacement))
            return yield* rejected('slot_conflict')
          const replacement = input.replacement
          yield* orUnavailable('booking-rescheduling')(
            db
              .update(rescheduleSessions)
              .set({
                holdId: replacement.hold.id,
                replacementProviderId: replacement.hold.providerId,
                replacementStartsAt: replacement.hold.startsAt,
                replacementEndsAt: replacement.hold.endsAt,
                holdExpiresAt: replacement.hold.expiresAt,
                pricingQuoteId: replacement.quote.id,
                pricingQuoteVersion: replacement.quote.version,
                replacementTotalMinor: replacement.quote.totalMinor,
                replacementCurrency: replacement.quote.currency,
                quoteAcceptedAt: replacement.quote.acceptedAt,
                quoteExpiresAt: replacement.quote.expiresAt,
                policyId: replacement.policyAcceptance.policyId,
                policyVersion: replacement.policyAcceptance.policyVersion,
                policyDisclosureSnapshot:
                  replacement.policyAcceptance.disclosureSnapshot,
                policyAcceptedAt: replacement.policyAcceptance.acceptedAt,
                settlementKind: replacement.settlement.kind,
                settlementAmountMinor: replacement.settlement.amountMinor,
                settlementReferenceId: replacement.settlement.referenceId,
                reminderAt: replacement.reminderAt,
                updatedAt: input.now
              })
              .where(
                and(
                  eq(rescheduleSessions.id, session.id),
                  eq(rescheduleSessions.status, 'active')
                )
              )
          )
          return yield* readSession(session.id, input.capabilityHash)
        }),
      commit: (input) =>
        Effect.gen(function* () {
          const [replay] = yield* orUnavailable('booking-rescheduling')(
            db
              .select()
              .from(rescheduleCommands)
              .where(
                and(
                  eq(rescheduleCommands.merchantId, input.merchantId),
                  eq(rescheduleCommands.idempotencyKey, input.idempotencyKey)
                )
              )
              .limit(1)
          )
          if (replay) {
            if (replay.rescheduleSessionId !== input.sessionId)
              return yield* rejected('idempotency_key_reused')
            return yield* readResult(replay, true)
          }
          const session = yield* readSession(input.sessionId, input.capabilityHash)
          if (session.merchantId !== input.merchantId)
            return yield* rejected('session_not_found')
          if (Date.parse(session.expiresAt) <= Date.parse(input.now)) {
            yield* orUnavailable('booking-rescheduling')(
              db
                .update(rescheduleSessions)
                .set({ status: 'expired', updatedAt: input.now })
                .where(eq(rescheduleSessions.id, session.id))
            )
            return yield* rejected('session_expired')
          }
          if (session.status !== 'active') return yield* rejected('session_not_active')
          if (!session.replacement) return yield* rejected('replacement_not_ready')
          const appointment = yield* readAppointment(
            input.merchantId,
            session.appointmentId
          )
          if (
            appointment.status !== 'scheduled' ||
            appointment.version !== session.baseAppointmentVersion
          )
            return yield* rejected('version_conflict')
          yield* Effect.try({
            try: () =>
              validateRescheduleReplacement(
                appointment,
                session.replacement!,
                input.now
              ),
            catch: (error) =>
              error instanceof BookingRescheduleRejected
                ? error
                : new CapabilityUnavailable({
                    capability: 'booking-rescheduling',
                    reason: 'replacement_validation_failed'
                  })
          })
          yield* verifyDurableReplacement(session, appointment, session.replacement)
          if (yield* hasSlotConflict(appointment.id, session.replacement))
            return yield* rejected('slot_conflict')

          const replacement = session.replacement
          const fromVersion = appointment.version
          const toVersion = fromVersion + 1
          const commandId = `rcm_${stableSuffix(`${input.merchantId}:${input.idempotencyKey}`)}`
          const snapshot: StoredAppointmentSnapshot = {
            ...(appointment.snapshot as StoredAppointmentSnapshot),
            startsAt: replacement.hold.startsAt,
            endsAt: replacement.hold.endsAt,
            assignedProvider: {
              id: replacement.hold.providerId,
              displayName: replacement.hold.providerDisplayName
            },
            totalMinor: replacement.quote.totalMinor,
            currency: replacement.quote.currency,
            acceptedRescheduleQuote: {
              id: replacement.quote.id,
              version: replacement.quote.version
            },
            acceptedReschedulePolicy: {
              id: replacement.policyAcceptance.policyId,
              version: replacement.policyAcceptance.policyVersion,
              disclosureSnapshot: replacement.policyAcceptance.disclosureSnapshot,
              acceptedAt: replacement.policyAcceptance.acceptedAt
            },
            rescheduleSettlement: replacement.settlement
          }
          const reminderKey = replacement.reminderAt
            ? `reminder:${appointment.id}:${toVersion}:${replacement.reminderAt}`
            : null
          const statements = [
            ...(replacement.settlement.kind === 'refund'
              ? [
                  db
                    .insert(refundObligations)
                    .values({
                      id: replacement.settlement.referenceId!,
                      appointmentId: appointment.id,
                      amountMinor: replacement.settlement.amountMinor,
                      currency: replacement.quote.currency,
                      idempotencyKey: `reschedule-refund:${appointment.id}:${fromVersion}`,
                      createdAt: input.now,
                      updatedAt: input.now
                    })
                    .onConflictDoNothing()
                ]
              : []),
            db.insert(rescheduleCommands).values({
              id: commandId,
              merchantId: input.merchantId,
              appointmentId: appointment.id,
              rescheduleSessionId: session.id,
              fromVersion,
              toVersion,
              idempotencyKey: input.idempotencyKey,
              committedAt: input.now,
              createdAt: input.now
            }),
            db
              .update(appointments)
              .set({
                providerId: replacement.hold.providerId,
                startsAt: replacement.hold.startsAt,
                endsAt: replacement.hold.endsAt,
                snapshot,
                version: toVersion,
                updatedAt: input.now
              })
              .where(
                and(
                  eq(appointments.id, appointment.id),
                  eq(appointments.status, 'scheduled'),
                  eq(appointments.version, fromVersion)
                )
              ),
            db.insert(lifecycleHistory).values({
              id: `alh_${stableSuffix(`${session.id}:${fromVersion}`)}`,
              aggregateType: 'appointment',
              aggregateId: appointment.id,
              fromState: 'scheduled',
              toState: 'scheduled',
              reasonCode: 'customer_rescheduled',
              factsJson: JSON.stringify({
                fromVersion,
                toVersion,
                prior: {
                  providerId: appointment.providerId,
                  startsAt: appointment.startsAt,
                  endsAt: appointment.endsAt,
                  totalMinor: appointment.snapshot.totalMinor,
                  currency: appointment.snapshot.currency
                },
                replacement: {
                  providerId: replacement.hold.providerId,
                  startsAt: replacement.hold.startsAt,
                  endsAt: replacement.hold.endsAt,
                  pricingQuoteId: replacement.quote.id,
                  pricingQuoteVersion: replacement.quote.version,
                  totalMinor: replacement.quote.totalMinor,
                  currency: replacement.quote.currency,
                  policyId: replacement.policyAcceptance.policyId,
                  policyVersion: replacement.policyAcceptance.policyVersion,
                  settlement: replacement.settlement
                }
              }),
              occurredAt: input.now,
              createdAt: input.now
            }),
            db
              .update(notificationIntents)
              .set({ status: 'cancelled', updatedAt: input.now })
              .where(
                and(
                  eq(notificationIntents.sourceType, 'appointment'),
                  eq(notificationIntents.sourceId, appointment.id),
                  lt(notificationIntents.sourceVersion, toVersion),
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
                  eq(scheduledWork.kind, 'appointment.reminder'),
                  eq(scheduledWork.sourceType, 'appointment'),
                  eq(scheduledWork.sourceId, appointment.id),
                  lt(scheduledWork.sourceVersion, toVersion),
                  inArray(scheduledWork.status, ['pending', 'running', 'failed'])
                )
              ),
            db
              .update(rescheduleSessions)
              .set({
                status: 'committed',
                committedAt: input.now,
                updatedAt: input.now
              })
              .where(eq(rescheduleSessions.id, session.id)),
            db.delete(timeSlotHolds).where(eq(timeSlotHolds.id, replacement.hold.id)),
            ...(replacement.reminderAt && reminderKey
              ? [
                  db.insert(notificationIntents).values({
                    id: `nti_${stableSuffix(reminderKey)}`,
                    shopId: appointment.shopId,
                    topic: 'appointment.reminder',
                    recipientJson: JSON.stringify({
                      email: (appointment.snapshot as StoredAppointmentSnapshot)
                        .customerDetails.email
                    }),
                    payloadJson: JSON.stringify({
                      appointmentId: appointment.id,
                      appointmentVersion: toVersion
                    }),
                    sourceType: 'appointment',
                    sourceId: appointment.id,
                    sourceVersion: toVersion,
                    deduplicationKey: reminderKey,
                    availableAt: replacement.reminderAt,
                    createdAt: input.now,
                    updatedAt: input.now
                  }),
                  db.insert(scheduledWork).values({
                    id: `scw_${stableSuffix(`work:${reminderKey}`)}`,
                    shopId: appointment.shopId,
                    kind: 'appointment.reminder',
                    sourceType: 'appointment',
                    sourceId: appointment.id,
                    sourceVersion: toVersion,
                    payloadJson: JSON.stringify({
                      appointmentId: appointment.id,
                      appointmentVersion: toVersion
                    }),
                    idempotencyKey: `work:${reminderKey}`,
                    runAt: replacement.reminderAt,
                    createdAt: input.now,
                    updatedAt: input.now
                  })
                ]
              : [])
          ]
          const concurrent = yield* orUnavailable('booking-rescheduling')(
            batch(db, statements)
          ).pipe(
            Effect.as(false),
            Effect.catchTag('CapabilityUnavailable', () => Effect.succeed(true))
          )
          if (concurrent) {
            const [winner] = yield* orUnavailable('booking-rescheduling')(
              db
                .select()
                .from(rescheduleCommands)
                .where(
                  and(
                    eq(rescheduleCommands.merchantId, input.merchantId),
                    eq(rescheduleCommands.idempotencyKey, input.idempotencyKey)
                  )
                )
                .limit(1)
            )
            if (winner) {
              if (winner.rescheduleSessionId !== session.id)
                return yield* rejected('idempotency_key_reused')
              return yield* readResult(winner, true)
            }
            const current = yield* readAppointment(input.merchantId, appointment.id)
            if (current.version !== fromVersion || current.status !== 'scheduled')
              return yield* rejected('version_conflict')
            if (yield* hasSlotConflict(appointment.id, replacement))
              return yield* rejected('slot_conflict')
            return yield* new CapabilityUnavailable({
              capability: 'booking-rescheduling',
              reason: 'atomic_reschedule_commit_failed'
            })
          }
          const [stored] = yield* orUnavailable('booking-rescheduling')(
            db
              .select()
              .from(rescheduleCommands)
              .where(eq(rescheduleCommands.id, commandId))
              .limit(1)
          )
          if (!stored)
            return yield* new CapabilityUnavailable({
              capability: 'booking-rescheduling',
              reason: 'reschedule_command_missing_after_commit'
            })
          return yield* readResult(stored, false)
        })
    }
  })
)
