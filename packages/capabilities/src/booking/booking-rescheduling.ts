import { Context, Effect, Layer, Schema } from 'effect'
import { CapabilityUnavailable } from '../errors.ts'

export type AppointmentRescheduleSnapshot = Readonly<
  Record<string, unknown> & {
    readonly totalMinor: number
    readonly currency: string
    readonly assignedProvider: { readonly id: string; readonly displayName: string }
    readonly providerPreference?:
      | { readonly kind: 'any' }
      | { readonly kind: 'specific'; readonly providerId: string }
    readonly services?: ReadonlyArray<{
      readonly id: string
      readonly role: 'primary' | 'additional'
      readonly name: string
      readonly durationMinutes: number
      readonly priceMinor: number
      readonly currency: string
    }>
    readonly customerDetails?: {
      readonly name: string
      readonly email: string
      readonly phone: string | null
    }
    readonly startsAt: string
    readonly endsAt: string
  }
>

export type ReschedulableAppointment = {
  readonly id: string
  readonly merchantId: string
  readonly shopId: string
  readonly bookingPartyId?: string | null
  readonly status: 'scheduled' | 'completed' | 'cancelled' | 'no_show'
  readonly version: number
  readonly providerId: string
  readonly startsAt: string
  readonly endsAt: string
  readonly snapshot: AppointmentRescheduleSnapshot
}

export type RescheduleTimeSlotHold = {
  readonly id: string
  readonly providerId: string
  readonly providerDisplayName: string
  readonly startsAt: string
  readonly endsAt: string
  readonly expiresAt: string
}

export type ReschedulePricingQuote = {
  readonly id: string
  readonly version: number
  readonly totalMinor: number
  readonly currency: string
  readonly acceptedAt: string
  readonly expiresAt: string
}

export type ReschedulePolicyAcceptance = {
  readonly policyId: string
  readonly policyVersion: number
  readonly disclosureSnapshot: string
  readonly acceptedAt: string
}

export type RescheduleSettlement = {
  readonly kind: 'unchanged' | 'refund' | 'additional_collection'
  readonly amountMinor: number
  readonly referenceId: string | null
}

export type RescheduleReplacement = {
  readonly hold: RescheduleTimeSlotHold
  readonly quote: ReschedulePricingQuote
  readonly policyAcceptance: ReschedulePolicyAcceptance
  readonly settlement: RescheduleSettlement
  readonly reminderAt: string | null
}

export type RescheduleSession = {
  readonly id: string
  readonly appointmentId: string
  readonly merchantId: string
  readonly bookingSessionId: string
  readonly bookingPartyId: string
  readonly purpose: 'appointment_reschedule'
  readonly baseAppointmentVersion: number
  readonly status: 'active' | 'committed' | 'expired' | 'failed'
  readonly expiresAt: string
  readonly replacement: RescheduleReplacement | null
  readonly committedAt: string | null
}

export type AppointmentRescheduleHistory = {
  readonly id: string
  readonly appointmentId: string
  readonly fromVersion: number
  readonly toVersion: number
  readonly prior: {
    readonly providerId: string
    readonly startsAt: string
    readonly endsAt: string
    readonly totalMinor: number
    readonly currency: string
  }
  readonly replacement: {
    readonly providerId: string
    readonly startsAt: string
    readonly endsAt: string
    readonly totalMinor: number
    readonly currency: string
    readonly pricingQuoteId: string
    readonly pricingQuoteVersion: number
    readonly policyId: string
    readonly policyVersion: number
    readonly settlement: RescheduleSettlement
  }
  readonly occurredAt: string
}

export type VersionedReminderIntent = {
  readonly id: string
  readonly appointmentId: string
  readonly appointmentVersion: number
  readonly status: 'pending' | 'processing' | 'delivered' | 'failed' | 'cancelled'
  readonly availableAt: string
  readonly deduplicationKey: string
}

export type VersionedReminderWork = {
  readonly id: string
  readonly appointmentId: string
  readonly appointmentVersion: number
  readonly status: 'pending' | 'running' | 'completed' | 'cancelled' | 'failed'
  readonly runAt: string
  readonly idempotencyKey: string
}

export type RescheduleResult = {
  readonly commandId: string
  readonly sessionId: string
  readonly appointment: ReschedulableAppointment
  readonly fromVersion: number
  readonly toVersion: number
  readonly replayed: boolean
}

export class BookingRescheduleRejected extends Schema.TaggedErrorClass<BookingRescheduleRejected>()(
  'BookingRescheduleRejected',
  {
    code: Schema.Literals([
      'appointment_not_found',
      'appointment_not_reschedulable',
      'session_not_found',
      'session_expired',
      'session_not_active',
      'replacement_not_ready',
      'slot_conflict',
      'hold_expired',
      'quote_invalid',
      'policy_required',
      'settlement_mismatch',
      'version_conflict',
      'idempotency_key_reused'
    ])
  }
) {}

type RescheduleError = BookingRescheduleRejected | CapabilityUnavailable

export type BookingReschedulingShape = {
  readonly begin: (input: {
    readonly merchantId: string
    readonly appointmentId: string
    readonly capabilityHash: string
    readonly expiresAt: string
    readonly now: string
  }) => Effect.Effect<RescheduleSession, RescheduleError>
  readonly prepare: (input: {
    readonly sessionId: string
    readonly capabilityHash: string
    readonly replacement: RescheduleReplacement
    readonly now: string
  }) => Effect.Effect<RescheduleSession, RescheduleError>
  readonly commit: (input: {
    readonly merchantId: string
    readonly sessionId: string
    readonly capabilityHash: string
    readonly idempotencyKey: string
    readonly now: string
  }) => Effect.Effect<RescheduleResult, RescheduleError>
}

export class BookingRescheduling extends Context.Service<
  BookingRescheduling,
  BookingReschedulingShape
>()('@b2b-saas-starter/capabilities/BookingRescheduling') {}

type StoredSession = RescheduleSession & { readonly capabilityHash: string }

export type SeedBookingReschedulingStore = {
  readonly appointments: Map<string, ReschedulableAppointment>
  readonly sessions: Map<string, StoredSession>
  readonly history: AppointmentRescheduleHistory[]
  readonly notificationIntents: VersionedReminderIntent[]
  readonly scheduledWork: VersionedReminderWork[]
  readonly commands: Map<string, RescheduleResult>
  readonly commandSessions: Map<string, string>
}

export const emptySeedBookingReschedulingStore = (
  appointments: readonly ReschedulableAppointment[] = [],
  options: {
    readonly notificationIntents?: readonly VersionedReminderIntent[]
    readonly scheduledWork?: readonly VersionedReminderWork[]
  } = {}
): SeedBookingReschedulingStore => ({
  appointments: new Map(appointments.map((record) => [record.id, record])),
  sessions: new Map(),
  history: [],
  notificationIntents: [...(options.notificationIntents ?? [])],
  scheduledWork: [...(options.scheduledWork ?? [])],
  commands: new Map(),
  commandSessions: new Map()
})

const stableSuffix = (value: string) => {
  let hash = 2166136261
  for (const character of value)
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619)
  return (hash >>> 0).toString(36)
}

const fail = (
  code: ConstructorParameters<typeof BookingRescheduleRejected>[0]['code']
) => new BookingRescheduleRejected({ code })

const overlaps = (
  left: { readonly startsAt: string; readonly endsAt: string },
  right: { readonly startsAt: string; readonly endsAt: string }
) => left.startsAt < right.endsAt && left.endsAt > right.startsAt

export const validateRescheduleReplacement = (
  appointment: ReschedulableAppointment,
  replacement: RescheduleReplacement,
  now: string
) => {
  if (
    replacement.hold.startsAt >= replacement.hold.endsAt ||
    Date.parse(replacement.hold.expiresAt) <= Date.parse(now)
  )
    throw fail('hold_expired')
  if (
    !replacement.quote.acceptedAt ||
    Date.parse(replacement.quote.expiresAt) <= Date.parse(now) ||
    replacement.quote.currency !== appointment.snapshot.currency
  )
    throw fail('quote_invalid')
  if (
    !replacement.policyAcceptance.acceptedAt ||
    !replacement.policyAcceptance.disclosureSnapshot.trim()
  )
    throw fail('policy_required')
  const difference = replacement.quote.totalMinor - appointment.snapshot.totalMinor
  const expectedKind =
    difference === 0 ? 'unchanged' : difference < 0 ? 'refund' : 'additional_collection'
  if (
    replacement.settlement.kind !== expectedKind ||
    replacement.settlement.amountMinor !== Math.abs(difference) ||
    (difference !== 0 && !replacement.settlement.referenceId)
  )
    throw fail('settlement_mismatch')
}

const publicSession = ({ capabilityHash: _, ...session }: StoredSession) => session

export const SeedBookingRescheduling = (
  store = emptySeedBookingReschedulingStore()
): Layer.Layer<BookingRescheduling> =>
  Layer.succeed(BookingRescheduling)({
    begin: (input) =>
      Effect.try({
        try: () => {
          const appointment = store.appointments.get(input.appointmentId)
          if (!appointment || appointment.merchantId !== input.merchantId)
            throw fail('appointment_not_found')
          if (appointment.status !== 'scheduled')
            throw fail('appointment_not_reschedulable')
          const id = `rsc_${stableSuffix(`${input.appointmentId}:${input.capabilityHash}`)}`
          const existing = store.sessions.get(id)
          if (existing) return publicSession(existing)
          const session: StoredSession = {
            id,
            appointmentId: appointment.id,
            merchantId: appointment.merchantId,
            bookingSessionId: `bsn_${id}`,
            bookingPartyId: `bpt_${id}`,
            purpose: 'appointment_reschedule',
            capabilityHash: input.capabilityHash,
            baseAppointmentVersion: appointment.version,
            status: 'active',
            expiresAt: input.expiresAt,
            replacement: null,
            committedAt: null
          }
          store.sessions.set(id, session)
          return publicSession(session)
        },
        catch: (error) =>
          error instanceof BookingRescheduleRejected
            ? error
            : new CapabilityUnavailable({
                capability: 'booking-rescheduling',
                reason: 'unexpected seed adapter failure'
              })
      }),
    prepare: (input) =>
      Effect.try({
        try: () => {
          const session = store.sessions.get(input.sessionId)
          if (!session || session.capabilityHash !== input.capabilityHash)
            throw fail('session_not_found')
          if (Date.parse(session.expiresAt) <= Date.parse(input.now)) {
            store.sessions.set(session.id, { ...session, status: 'expired' })
            throw fail('session_expired')
          }
          if (session.status !== 'active') throw fail('session_not_active')
          const appointment = store.appointments.get(session.appointmentId)
          if (!appointment) throw fail('appointment_not_found')
          validateRescheduleReplacement(appointment, input.replacement, input.now)
          const conflict = [...store.appointments.values()].some(
            (candidate) =>
              candidate.id !== appointment.id &&
              candidate.status === 'scheduled' &&
              candidate.providerId === input.replacement.hold.providerId &&
              overlaps(candidate, input.replacement.hold)
          )
          if (conflict) throw fail('slot_conflict')
          const prepared = { ...session, replacement: input.replacement }
          store.sessions.set(session.id, prepared)
          return publicSession(prepared)
        },
        catch: (error) =>
          error instanceof BookingRescheduleRejected
            ? error
            : new CapabilityUnavailable({
                capability: 'booking-rescheduling',
                reason: 'unexpected seed adapter failure'
              })
      }),
    commit: (input) =>
      Effect.try({
        try: () => {
          const commandKey = `${input.merchantId}:${input.idempotencyKey}`
          const replay = store.commands.get(commandKey)
          if (replay) {
            if (store.commandSessions.get(commandKey) !== input.sessionId)
              throw fail('idempotency_key_reused')
            return { ...replay, replayed: true }
          }
          const session = store.sessions.get(input.sessionId)
          if (
            !session ||
            session.merchantId !== input.merchantId ||
            session.capabilityHash !== input.capabilityHash
          )
            throw fail('session_not_found')
          if (Date.parse(session.expiresAt) <= Date.parse(input.now)) {
            store.sessions.set(session.id, { ...session, status: 'expired' })
            throw fail('session_expired')
          }
          if (session.status !== 'active') throw fail('session_not_active')
          if (!session.replacement) throw fail('replacement_not_ready')
          const appointment = store.appointments.get(session.appointmentId)
          if (!appointment || appointment.merchantId !== input.merchantId)
            throw fail('appointment_not_found')
          if (
            appointment.status !== 'scheduled' ||
            appointment.version !== session.baseAppointmentVersion
          )
            throw fail('version_conflict')
          validateRescheduleReplacement(appointment, session.replacement, input.now)
          const conflict = [...store.appointments.values()].some(
            (candidate) =>
              candidate.id !== appointment.id &&
              candidate.status === 'scheduled' &&
              candidate.providerId === session.replacement!.hold.providerId &&
              overlaps(candidate, session.replacement!.hold)
          )
          if (conflict) throw fail('slot_conflict')

          const fromVersion = appointment.version
          const toVersion = fromVersion + 1
          const replacement = session.replacement
          const next: ReschedulableAppointment = {
            ...appointment,
            version: toVersion,
            providerId: replacement.hold.providerId,
            startsAt: replacement.hold.startsAt,
            endsAt: replacement.hold.endsAt,
            snapshot: {
              ...appointment.snapshot,
              totalMinor: replacement.quote.totalMinor,
              currency: replacement.quote.currency,
              assignedProvider: {
                id: replacement.hold.providerId,
                displayName: replacement.hold.providerDisplayName
              },
              startsAt: replacement.hold.startsAt,
              endsAt: replacement.hold.endsAt,
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
          }
          const history: AppointmentRescheduleHistory = {
            id: `alh_${stableSuffix(`${session.id}:${fromVersion}`)}`,
            appointmentId: appointment.id,
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
              totalMinor: replacement.quote.totalMinor,
              currency: replacement.quote.currency,
              pricingQuoteId: replacement.quote.id,
              pricingQuoteVersion: replacement.quote.version,
              policyId: replacement.policyAcceptance.policyId,
              policyVersion: replacement.policyAcceptance.policyVersion,
              settlement: replacement.settlement
            },
            occurredAt: input.now
          }

          for (let index = 0; index < store.notificationIntents.length; index++) {
            const intent = store.notificationIntents[index]!
            if (
              intent.appointmentId === appointment.id &&
              intent.appointmentVersion < toVersion &&
              (intent.status === 'pending' ||
                intent.status === 'processing' ||
                intent.status === 'failed')
            )
              store.notificationIntents[index] = { ...intent, status: 'cancelled' }
          }
          for (let index = 0; index < store.scheduledWork.length; index++) {
            const work = store.scheduledWork[index]!
            if (
              work.appointmentId === appointment.id &&
              work.appointmentVersion < toVersion &&
              (work.status === 'pending' ||
                work.status === 'running' ||
                work.status === 'failed')
            )
              store.scheduledWork[index] = { ...work, status: 'cancelled' }
          }
          if (replacement.reminderAt) {
            const deduplicationKey = `reminder:${appointment.id}:${toVersion}:${replacement.reminderAt}`
            if (
              !store.notificationIntents.some(
                (intent) => intent.deduplicationKey === deduplicationKey
              )
            )
              store.notificationIntents.push({
                id: `nti_${stableSuffix(deduplicationKey)}`,
                appointmentId: appointment.id,
                appointmentVersion: toVersion,
                status: 'pending',
                availableAt: replacement.reminderAt,
                deduplicationKey
              })
            const idempotencyKey = `work:${deduplicationKey}`
            if (
              !store.scheduledWork.some(
                (work) => work.idempotencyKey === idempotencyKey
              )
            )
              store.scheduledWork.push({
                id: `scw_${stableSuffix(idempotencyKey)}`,
                appointmentId: appointment.id,
                appointmentVersion: toVersion,
                status: 'pending',
                runAt: replacement.reminderAt,
                idempotencyKey
              })
          }
          const committedSession: StoredSession = {
            ...session,
            status: 'committed',
            committedAt: input.now
          }
          const result: RescheduleResult = {
            commandId: `rcm_${stableSuffix(commandKey)}`,
            sessionId: session.id,
            appointment: next,
            fromVersion,
            toVersion,
            replayed: false
          }
          store.appointments.set(appointment.id, next)
          store.history.push(history)
          store.sessions.set(session.id, committedSession)
          store.commands.set(commandKey, result)
          store.commandSessions.set(commandKey, session.id)
          return result
        },
        catch: (error) =>
          error instanceof BookingRescheduleRejected
            ? error
            : new CapabilityUnavailable({
                capability: 'booking-rescheduling',
                reason: 'unexpected seed adapter failure'
              })
      })
  })
