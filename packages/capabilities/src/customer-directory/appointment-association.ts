import { Effect } from 'effect'
import { and, eq, isNull, or, sql } from 'drizzle-orm'
import {
  appointmentFoundations,
  customerContacts,
  customerBans,
  customerDuplicateSuggestions,
  customerDirectoryHistory,
  customerObservations,
  customerRecords,
  type BatchStatement,
  type EffectDatabase
} from '@b2b-saas-starter/db'
import { newCapabilityId } from '../internal/ids.ts'
import { orUnavailable } from '../internal/unavailable.ts'
import { CapabilityUnavailable } from '../errors.ts'

export type AppointmentCustomerAssociationInput = {
  readonly merchantId: string
  readonly appointment: {
    readonly id: string
    readonly details: {
      readonly name: string
      readonly email: string | null
      readonly phone: string | null
    }
  }
  readonly origin: 'public_booking' | 'merchant_created' | 'record_completed'
  readonly now: string
}

const normalizeEmail = (value: string | null) => value?.trim().toLowerCase() || null
const normalizePhone = (value: string | null) => {
  const digits = value?.replace(/\D/g, '') ?? ''
  return digits ? `+${digits}` : null
}
const stableRecordId = (
  merchantId: string,
  identifiers: readonly { kind: string; value: string }[]
) => {
  const value = `${merchantId}:${identifiers
    .map(({ kind, value }) => `${kind}:${value}`)
    .sort()
    .join('|')}`
  let hash = 2166136261
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `cur_contact_${(hash >>> 0).toString(36)}`
}

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
                revision: customerRecords.revision
              })
              .from(customerContacts)
              .innerJoin(
                customerRecords,
                eq(customerRecords.id, customerContacts.customerRecordId)
              )
              .where(
                and(
                  eq(customerContacts.merchantId, input.merchantId),
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
    const resultingRevision = matchedId
      ? (matches.find((match) => match.customerRecordId === matchedId)?.revision ?? 0) +
        1
      : 1
    if (matchedId) {
      const bans = yield* orUnavailable('customer-directory')(
        db
          .select({ expiresAt: customerBans.expiresAt })
          .from(customerBans)
          .where(eq(customerBans.customerRecordId, matchedId))
      )
      if (bans.some((ban) => !ban.expiresAt || ban.expiresAt > input.now))
        return yield* Effect.fail(
          new CapabilityUnavailable({
            capability: 'customer-directory',
            reason: 'booking unavailable'
          })
        )
    }
    const recordId =
      matchedId ??
      (candidateIds.length === 0 && identifiers.length > 0
        ? stableRecordId(input.merchantId, identifiers)
        : newCapabilityId('cur'))
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
          .onConflictDoNothing()
      )
    } else {
      statements.push(
        db
          .update(customerRecords)
          .set({
            status: 'active',
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
      statements.push(
        db
          .insert(customerContacts)
          .values({
            id: `cuc_${recordId}_${identifier.kind}_${stableRecordId('', [identifier]).slice(12)}`,
            customerRecordId: recordId,
            merchantId: input.merchantId,
            kind: identifier.kind,
            normalizedValue: identifier.value,
            status: 'active',
            isPreferred: !matchedId,
            createdAt: input.now,
            updatedAt: input.now
          })
          .onConflictDoNothing()
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
    const foundationOrigin =
      input.origin === 'record_completed' ? 'merchant_created' : input.origin
    statements.push(
      db.insert(appointmentFoundations).values({
        appointmentId: appointment.id,
        merchantId: input.merchantId,
        customerRecordId: recordId,
        origin: foundationOrigin,
        createdAt: input.now
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
          actorId:
            input.origin === 'public_booking' ? 'public-customer' : 'merchant-owner',
          reason: input.origin,
          revision: resultingRevision,
          occurredAt: input.now
        })
        .onConflictDoNothing()
    )
    return statements
  })
