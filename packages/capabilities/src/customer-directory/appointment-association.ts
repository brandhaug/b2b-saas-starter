import { Effect } from 'effect'
import { and, eq, isNull, or, sql } from 'drizzle-orm'
import {
  appointmentFoundations,
  customerContacts,
  customerBans,
  customerDuplicateSuggestions,
  customerDirectoryHistory,
  customerDirectoryStates,
  customerObservations,
  customerRecords,
  type BatchStatement,
  type EffectDatabase
} from '@b2b-saas-starter/db'
import { newCapabilityId } from '../internal/ids.ts'
import { hashSha256 } from '../internal/crypto.ts'
import { orUnavailable } from '../internal/unavailable.ts'
import { CapabilityUnavailable } from '../errors.ts'

type AppointmentCustomerAssociationBase = {
  readonly merchantId: string
  readonly appointment: {
    readonly id: string
    readonly details: {
      readonly name: string
      readonly email: string | null
      readonly phone: string | null
      readonly note?: string
    }
  }
  readonly merchantPolicy?: {
    readonly restoreArchived: boolean
    readonly allowBanned: boolean
  }
  readonly now: string
}

export type AppointmentCustomerAssociationInput = AppointmentCustomerAssociationBase &
  (
    | { readonly origin: 'public_booking' }
    | {
        readonly origin: 'merchant_created' | 'record_completed'
        readonly actor: {
          readonly merchantMemberId: string
          readonly impersonatedBy?: string | null
        }
      }
  )

const normalizeEmail = (value: string | null) => value?.trim().toLowerCase() || null
const normalizePhone = (value: string | null) => {
  const digits = value?.replace(/\D/g, '') ?? ''
  return digits ? `+${digits}` : null
}
const stableRecordId = (
  merchantId: string,
  identifier: { kind: string; value: string }
) =>
  hashSha256(`${merchantId}:${identifier.kind}:${identifier.value}`).then(
    (hash) => `cur_contact_${hash.slice(0, 32)}`
  )

/**
 * Prepares directory writes for the caller's Appointment-creation batch. No write is
 * executed here: Appointment, association, observation, and any new Customer Record
 * therefore commit or roll back together.
 */
export const prepareAppointmentCustomerAssociation = (
  db: EffectDatabase,
  input: AppointmentCustomerAssociationInput
): Effect.Effect<readonly BatchStatement[], CapabilityUnavailable> =>
  Effect.gen(function* () {
    const existingAssociation = yield* orUnavailable('customer-directory')(
      db
        .select({
          merchantId: appointmentFoundations.merchantId,
          customerRecordId: appointmentFoundations.customerRecordId
        })
        .from(appointmentFoundations)
        .where(eq(appointmentFoundations.appointmentId, input.appointment.id))
        .limit(1)
    )
    if (existingAssociation[0]) {
      if (existingAssociation[0].merchantId !== input.merchantId)
        return yield* Effect.fail(
          new CapabilityUnavailable({
            capability: 'customer-directory',
            reason: 'appointment association unavailable'
          })
        )
      if (existingAssociation[0].customerRecordId) return []
    }
    const first = input.appointment
    const details = {
      name: first.details.name.trim(),
      email: normalizeEmail(first.details.email),
      phone: normalizePhone(first.details.phone)
    }
    const identifiers = [
      details.email ? { kind: 'email' as const, value: details.email } : null,
      details.phone ? { kind: 'phone' as const, value: details.phone } : null
    ].filter((item): item is NonNullable<typeof item> => item !== null)
    const matches =
      identifiers.length === 0
        ? []
        : yield* orUnavailable('customer-directory')(
            db
              .select({
                customerRecordId: customerContacts.customerRecordId,
                kind: customerContacts.kind,
                value: customerContacts.normalizedValue,
                recordStatus: customerRecords.status
              })
              .from(customerContacts)
              .innerJoin(
                customerRecords,
                eq(customerRecords.id, customerContacts.customerRecordId)
              )
              .where(
                and(
                  eq(customerContacts.merchantId, input.merchantId),
                  eq(customerRecords.merchantId, input.merchantId),
                  eq(customerContacts.status, 'active'),
                  isNull(customerRecords.mergedInto),
                  or(
                    ...identifiers.map((identifier) =>
                      and(
                        eq(customerContacts.kind, identifier.kind),
                        eq(customerContacts.normalizedValue, identifier.value)
                      )
                    )
                  )
                )
              )
          )
    const candidateIds = [...new Set(matches.map((match) => match.customerRecordId))]
    const matchedId = candidateIds.length === 1 ? candidateIds[0] : undefined
    const matchedStatus = matches.find(
      ({ customerRecordId }) => customerRecordId === matchedId
    )?.recordStatus
    if (matchedId) {
      if (
        input.origin === 'merchant_created' &&
        matchedStatus === 'quarantined' &&
        input.merchantPolicy?.restoreArchived !== true
      )
        return yield* Effect.fail(
          new CapabilityUnavailable({
            capability: 'customer-directory',
            reason: 'archived customer requires explicit restore'
          })
        )
      const bans = yield* orUnavailable('customer-directory')(
        db
          .select({ expiresAt: customerBans.expiresAt })
          .from(customerBans)
          .where(
            and(
              eq(customerBans.customerRecordId, matchedId),
              eq(customerBans.merchantId, input.merchantId)
            )
          )
      )
      const banApplies =
        input.origin === 'public_booking' ||
        (input.origin === 'merchant_created' &&
          input.merchantPolicy?.allowBanned !== true)
      if (banApplies && bans.some((ban) => !ban.expiresAt || ban.expiresAt > input.now))
        return yield* Effect.fail(
          new CapabilityUnavailable({
            capability: 'customer-directory',
            reason: 'booking unavailable'
          })
        )
    }
    const recordId = matchedId
      ? matchedId
      : candidateIds.length === 0 && identifiers.length > 0
        ? yield* Effect.promise(() =>
            stableRecordId(
              input.merchantId,
              identifiers.find(({ kind }) => kind === 'email') ?? identifiers[0]!
            )
          )
        : newCapabilityId('cur')
    const statements: BatchStatement[] = []
    if (!matchedId) {
      statements.push(
        db
          .insert(customerRecords)
          .values({
            id: recordId,
            merchantId: input.merchantId,
            displayName: details.name,
            status: 'active',
            preferredLocale: 'en',
            revision: 1,
            lastActivityAt: input.now,
            createdAt: input.now,
            updatedAt: input.now
          })
          .onConflictDoUpdate({
            target: customerRecords.id,
            set: {
              revision: sql`${customerRecords.revision} + 1`,
              lastActivityAt: input.now,
              updatedAt: input.now
            }
          })
      )
    } else {
      const restoreMatchedRecord =
        input.origin === 'public_booking' ||
        (input.origin === 'merchant_created' &&
          input.merchantPolicy?.restoreArchived === true)
      statements.push(
        db
          .update(customerRecords)
          .set({
            ...(restoreMatchedRecord ? { status: 'active' as const } : {}),
            lastActivityAt: input.now,
            revision: sql`${customerRecords.revision} + 1`,
            updatedAt: input.now
          })
          .where(
            and(
              eq(customerRecords.id, matchedId),
              eq(customerRecords.merchantId, input.merchantId)
            )
          )
      )
    }
    const matchedKeys = new Set(matches.map((match) => `${match.kind}:${match.value}`))
    for (const identifier of identifiers) {
      if (matchedId && matchedKeys.has(`${identifier.kind}:${identifier.value}`))
        continue
      const contactId = yield* Effect.promise(() => stableRecordId('', identifier))
      statements.push(
        db
          .insert(customerContacts)
          .values({
            id: `cuc_${recordId}_${identifier.kind}_${contactId.slice(12)}`,
            customerRecordId: recordId,
            merchantId: input.merchantId,
            kind: identifier.kind,
            normalizedValue: identifier.value,
            status: candidateIds.length > 1 ? 'disputed' : 'active',
            isPreferred: !matchedId && candidateIds.length === 0,
            createdAt: input.now,
            updatedAt: input.now
          })
          .onConflictDoNothing({ target: customerContacts.id })
      )
    }
    if (!matchedId) {
      for (const possibleDuplicateId of candidateIds)
        statements.push(
          db.insert(customerDuplicateSuggestions).values({
            merchantId: input.merchantId,
            customerRecordId: recordId,
            possibleDuplicateId,
            createdAt: input.now
          })
        )
    }
    const appointment = input.appointment
    const historyActor =
      input.origin === 'public_booking'
        ? { actorId: 'public-customer', impersonatedBy: null }
        : {
            actorId: input.actor.merchantMemberId,
            impersonatedBy: input.actor.impersonatedBy ?? null
          }
    const foundationOrigin =
      input.origin === 'record_completed' ? 'merchant_created' : input.origin
    statements.push(
      db
        .insert(appointmentFoundations)
        .values({
          appointmentId: appointment.id,
          merchantId: input.merchantId,
          customerRecordId: recordId,
          origin: foundationOrigin,
          customerNote: appointment.details.note?.trim() || null,
          createdAt: input.now
        })
        .onConflictDoUpdate({
          target: appointmentFoundations.appointmentId,
          set: {
            customerRecordId: recordId
          },
          setWhere: eq(appointmentFoundations.merchantId, input.merchantId)
        }),
      db.insert(customerObservations).values({
        id: newCapabilityId('cuo'),
        merchantId: input.merchantId,
        customerRecordId: recordId,
        appointmentId: appointment.id,
        name: appointment.details.name.trim(),
        normalizedEmail: normalizeEmail(appointment.details.email),
        normalizedPhone: normalizePhone(appointment.details.phone),
        source: input.origin,
        observedAt: input.now
      }),
      db
        .insert(customerDirectoryHistory)
        .values({
          id: `cuh_${appointment.id}`,
          merchantId: input.merchantId,
          customerRecordId: recordId,
          kind: matchedId ? 'appointment_observed' : 'created',
          actorId: historyActor.actorId,
          impersonatedBy: historyActor.impersonatedBy,
          reason: input.origin,
          revision: sql<number>`(SELECT ${customerRecords.revision} FROM ${customerRecords} WHERE ${customerRecords.id} = ${recordId})`,
          occurredAt: input.now
        })
        .onConflictDoNothing(),
      db
        .insert(customerDirectoryStates)
        .values({
          merchantId: input.merchantId,
          stateJson: { records: [], commands: [], imports: [] },
          revision: 1,
          updatedAt: input.now
        })
        .onConflictDoUpdate({
          target: customerDirectoryStates.merchantId,
          set: {
            revision: sql`${customerDirectoryStates.revision} + 1`,
            updatedAt: input.now
          }
        })
    )
    return statements
  })
