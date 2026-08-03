import { Context, Effect, Layer, Schema } from 'effect'
import { and, asc, desc, eq, gte, lt, sql } from 'drizzle-orm'
import {
  appointments,
  appointmentFoundations,
  Database,
  externalCollections,
  type StoredAppointmentSnapshot
} from '@b2b-saas-starter/db'
import { CapabilityUnavailable } from '../errors.ts'
import { orUnavailable } from '../internal/unavailable.ts'
import { MerchantContext } from '../merchant-catalog/merchant-context.ts'

export const AppointmentSnapshot = Schema.Struct({
  startsAt: Schema.String,
  endsAt: Schema.String,
  providerPreference: Schema.Union([
    Schema.Struct({ kind: Schema.Literal('any') }),
    Schema.Struct({ kind: Schema.Literal('specific'), providerId: Schema.String })
  ]),
  assignedProvider: Schema.Struct({ id: Schema.String, displayName: Schema.String }),
  services: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      role: Schema.Literals(['primary', 'additional']),
      name: Schema.String,
      durationMinutes: Schema.Number,
      beforeBufferMinutes: Schema.Number,
      afterBufferMinutes: Schema.Number,
      priceMinor: Schema.Number,
      currency: Schema.String
    })
  ),
  durationMinutes: Schema.Number,
  beforeBufferMinutes: Schema.Number,
  afterBufferMinutes: Schema.Number,
  occupiedStartsAt: Schema.String,
  occupiedEndsAt: Schema.String,
  currency: Schema.String,
  totalMinor: Schema.Number,
  merchantTimezone: Schema.String,
  customerDetails: Schema.Struct({
    name: Schema.String,
    email: Schema.String,
    phone: Schema.NullOr(Schema.String),
    note: Schema.optional(Schema.String)
  }),
  checkoutPath: Schema.Literals(['pay_in_person', 'online_payment'])
})
export type AppointmentSnapshot = typeof AppointmentSnapshot.Type
export const OperationalAppointment = Schema.Struct({
  id: Schema.String,
  merchantId: Schema.String,
  providerId: Schema.String,
  status: Schema.Literals(['scheduled', 'completed', 'cancelled', 'no_show']),
  revision: Schema.optional(Schema.Int),
  bookingPartyId: Schema.optional(Schema.NullOr(Schema.String)),
  seriesId: Schema.optional(Schema.NullOr(Schema.String)),
  seriesPosition: Schema.optional(Schema.NullOr(Schema.Int)),
  externalCollectionNetMinor: Schema.optional(Schema.Int),
  partyMembers: Schema.optional(
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        revision: Schema.Int,
        externalCollectionNetMinor: Schema.Int,
        status: Schema.Literals(['scheduled', 'completed', 'cancelled', 'no_show'])
      })
    )
  ),
  seriesMembers: Schema.optional(
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        revision: Schema.Int,
        externalCollectionNetMinor: Schema.Int,
        status: Schema.Literals(['scheduled', 'completed', 'cancelled', 'no_show'])
      })
    )
  ),
  startsAt: Schema.String,
  endsAt: Schema.String,
  snapshot: AppointmentSnapshot,
  createdAt: Schema.String
})
export type OperationalAppointment = typeof OperationalAppointment.Type

export const AppointmentDetailResult = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('found'), appointment: OperationalAppointment }),
  Schema.Struct({ kind: Schema.Literal('not_found') })
])
export type AppointmentDetailResult = typeof AppointmentDetailResult.Type

export const ProviderCalendar = Schema.Struct({
  date: Schema.String,
  timezone: Schema.String,
  providers: Schema.Array(
    Schema.Struct({
      provider: AppointmentSnapshot.fields.assignedProvider,
      appointments: Schema.Array(OperationalAppointment)
    })
  )
})
export type ProviderCalendar = typeof ProviderCalendar.Type

export const CustomerDirectory = Schema.Struct({
  timezone: Schema.String,
  entries: Schema.Array(
    Schema.Struct({
      appointmentId: Schema.String,
      appointmentStatus: OperationalAppointment.fields.status,
      scheduledAt: Schema.String,
      name: Schema.String,
      email: Schema.String,
      phone: Schema.NullOr(Schema.String)
    })
  )
})
export type CustomerDirectory = typeof CustomerDirectory.Type

export type AppointmentOperationsShape = {
  readonly calendar: (
    date?: string
  ) => Effect.Effect<ProviderCalendar, CapabilityUnavailable, MerchantContext>
  readonly detail: (
    appointmentId: string
  ) => Effect.Effect<AppointmentDetailResult, CapabilityUnavailable, MerchantContext>
  readonly customers: () => Effect.Effect<
    CustomerDirectory,
    CapabilityUnavailable,
    MerchantContext
  >
}

export class AppointmentOperations extends Context.Service<
  AppointmentOperations,
  AppointmentOperationsShape
>()('@b2b-saas-starter/capabilities/AppointmentOperations') {}

const dateInTimezone = (instant: string, timezone: string) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date(instant))
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? ''
  return `${value('year')}-${value('month')}-${value('day')}`
}

const addCalendarDays = (date: string, days: number): string => {
  const value = new Date(`${date}T12:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

const zonedMidnight = (date: string, timezone: string): Date => {
  const desired = Date.parse(`${date}T00:00:00.000Z`)
  let candidate = desired
  for (let index = 0; index < 3; index += 1) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }).formatToParts(new Date(candidate))
    const read = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((part) => part.type === type)?.value ?? ''
    const represented = Date.parse(
      `${read('year')}-${read('month')}-${read('day')}T${read('hour')}:${read('minute')}:00.000Z`
    )
    candidate += desired - represented
  }
  return new Date(candidate)
}

export const appointmentCalendarUtcRange = (date: string, timezone: string) => ({
  startsAt: zonedMidnight(date, timezone).toISOString(),
  endsAt: zonedMidnight(addCalendarDays(date, 1), timezone).toISOString()
})

const calendarProjection = (
  records: ReadonlyArray<OperationalAppointment>,
  date: string,
  timezone: string
): ProviderCalendar => {
  const groups = new Map<
    string,
    {
      provider: StoredAppointmentSnapshot['assignedProvider']
      appointments: Array<OperationalAppointment>
    }
  >()
  for (const appointment of records) {
    if (dateInTimezone(appointment.startsAt, timezone) !== date) continue
    const provider = appointment.snapshot.assignedProvider
    const groupKey = `${provider.id}\u0000${provider.displayName}`
    const existing = groups.get(groupKey)
    if (existing) existing.appointments.push(appointment)
    else groups.set(groupKey, { provider, appointments: [appointment] })
  }
  return {
    date,
    timezone,
    providers: [...groups.values()].sort((left, right) =>
      left.provider.displayName.localeCompare(right.provider.displayName)
    )
  }
}

const customerProjection = (
  records: ReadonlyArray<OperationalAppointment>,
  timezone: string
): CustomerDirectory => ({
  timezone,
  entries: records.map((appointment) => ({
    appointmentId: appointment.id,
    appointmentStatus: appointment.status,
    scheduledAt: appointment.startsAt,
    name: appointment.snapshot.customerDetails.name,
    email: appointment.snapshot.customerDetails.email,
    phone: appointment.snapshot.customerDetails.phone
  }))
})

export const SeedAppointmentOperations = (
  records: ReadonlyArray<OperationalAppointment>
): Layer.Layer<AppointmentOperations> =>
  Layer.succeed(AppointmentOperations)({
    calendar: (date) =>
      Effect.map(MerchantContext, (merchant) =>
        calendarProjection(
          records.filter((appointment) => appointment.merchantId === merchant.id),
          date ?? dateInTimezone(new Date().toISOString(), merchant.timezone),
          merchant.timezone
        )
      ),
    detail: (appointmentId) =>
      Effect.map(MerchantContext, (merchant) => {
        const appointment = records.find(
          (candidate) =>
            candidate.id === appointmentId && candidate.merchantId === merchant.id
        )
        return appointment
          ? ({ kind: 'found', appointment } as const)
          : ({ kind: 'not_found' } as const)
      }),
    customers: () =>
      Effect.map(MerchantContext, (merchant) =>
        customerProjection(
          records
            .filter((appointment) => appointment.merchantId === merchant.id)
            .sort((left, right) => right.startsAt.localeCompare(left.startsAt)),
          merchant.timezone
        )
      )
  })

const toAppointment = (
  row: typeof appointments.$inferSelect
): OperationalAppointment | null =>
  row.snapshot
    ? {
        ...row,
        snapshot: row.snapshot,
        revision: row.version,
        bookingPartyId: row.bookingPartyId
      }
    : null

export const LiveAppointmentOperations: Layer.Layer<
  AppointmentOperations,
  never,
  Database
> = Layer.effect(
  AppointmentOperations,
  Effect.gen(function* () {
    const db = yield* Database
    const list = (merchantId: string, direction: 'asc' | 'desc') =>
      Effect.map(
        orUnavailable('appointment-operations')(
          db
            .select()
            .from(appointments)
            .where(eq(appointments.merchantId, merchantId))
            .orderBy(
              direction === 'asc'
                ? asc(appointments.startsAt)
                : desc(appointments.startsAt)
            )
        ),
        (rows) => rows.map(toAppointment).filter((row) => row !== null)
      )
    const listCalendarDay = (merchantId: string, date: string, timezone: string) => {
      const range = appointmentCalendarUtcRange(date, timezone)
      return Effect.map(
        orUnavailable('appointment-operations')(
          db
            .select()
            .from(appointments)
            .where(
              and(
                eq(appointments.merchantId, merchantId),
                gte(appointments.startsAt, range.startsAt),
                lt(appointments.startsAt, range.endsAt)
              )
            )
            .orderBy(asc(appointments.startsAt))
        ),
        (rows) => rows.map(toAppointment).filter((row) => row !== null)
      )
    }
    return {
      calendar: (date) =>
        Effect.gen(function* () {
          const merchant = yield* MerchantContext
          const selectedDate =
            date ?? dateInTimezone(new Date().toISOString(), merchant.timezone)
          return calendarProjection(
            yield* listCalendarDay(merchant.id, selectedDate, merchant.timezone),
            selectedDate,
            merchant.timezone
          )
        }),
      detail: (appointmentId) =>
        Effect.gen(function* () {
          const merchant = yield* MerchantContext
          const rows = yield* orUnavailable('appointment-operations')(
            db
              .select()
              .from(appointments)
              .where(eq(appointments.id, appointmentId))
              .limit(1)
          )
          const appointment = rows[0] ? toAppointment(rows[0]) : null
          if (appointment?.merchantId === merchant.id) {
            const foundation = yield* orUnavailable('appointment-operations')(
              db
                .select({
                  seriesId: appointmentFoundations.seriesId,
                  seriesPosition: appointmentFoundations.seriesPosition
                })
                .from(appointmentFoundations)
                .where(
                  and(
                    eq(appointmentFoundations.appointmentId, appointmentId),
                    eq(appointmentFoundations.merchantId, merchant.id)
                  )
                )
                .limit(1)
            )
            const collection = yield* orUnavailable('appointment-operations')(
              db
                .select({
                  net: sql<number>`COALESCE(SUM(CASE ${externalCollections.kind} WHEN 'collection' THEN ${externalCollections.amountMinor} ELSE -${externalCollections.amountMinor} END), 0)`
                })
                .from(externalCollections)
                .where(
                  and(
                    eq(externalCollections.appointmentId, appointmentId),
                    eq(externalCollections.merchantId, merchant.id)
                  )
                )
            )
            const member = foundation[0]
            const net = collection[0]
            const seriesMembers = member?.seriesId
              ? yield* orUnavailable('appointment-operations')(
                  db
                    .select({
                      id: appointments.id,
                      revision: appointments.version,
                      externalCollectionNetMinor: sql<number>`COALESCE((SELECT SUM(CASE ec.kind WHEN 'collection' THEN ec.amount_minor ELSE -ec.amount_minor END) FROM external_collections ec WHERE ec.merchant_id = ${appointments.merchantId} AND ec.appointment_id = ${appointments.id}), 0)`,
                      status: appointments.status
                    })
                    .from(appointments)
                    .innerJoin(
                      appointmentFoundations,
                      eq(appointmentFoundations.appointmentId, appointments.id)
                    )
                    .where(
                      and(
                        eq(appointments.merchantId, merchant.id),
                        eq(appointmentFoundations.seriesId, member.seriesId)
                      )
                    )
                )
              : []
            const partyMembers = appointment.bookingPartyId
              ? yield* orUnavailable('appointment-operations')(
                  db
                    .select({
                      id: appointments.id,
                      revision: appointments.version,
                      externalCollectionNetMinor: sql<number>`COALESCE((SELECT SUM(CASE ec.kind WHEN 'collection' THEN ec.amount_minor ELSE -ec.amount_minor END) FROM external_collections ec WHERE ec.merchant_id = ${appointments.merchantId} AND ec.appointment_id = ${appointments.id}), 0)`,
                      status: appointments.status
                    })
                    .from(appointments)
                    .where(
                      and(
                        eq(appointments.merchantId, merchant.id),
                        eq(appointments.bookingPartyId, appointment.bookingPartyId)
                      )
                    )
                )
              : []
            return {
              kind: 'found',
              appointment: {
                ...appointment,
                seriesId: member?.seriesId ?? null,
                seriesPosition: member?.seriesPosition ?? null,
                externalCollectionNetMinor: net?.net ?? 0,
                partyMembers,
                seriesMembers
              }
            } as const
          }
          return appointment?.merchantId === merchant.id
            ? ({ kind: 'found', appointment } as const)
            : ({ kind: 'not_found' } as const)
        }),
      customers: () =>
        Effect.gen(function* () {
          const merchant = yield* MerchantContext
          return customerProjection(yield* list(merchant.id, 'desc'), merchant.timezone)
        })
    }
  })
)
