import { Context, Effect, Layer, Schema } from 'effect'
import { asc, desc, eq } from 'drizzle-orm'
import {
  appointments,
  Database,
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
      priceMinor: Schema.Number,
      currency: Schema.String
    })
  ),
  durationMinutes: Schema.Number,
  currency: Schema.String,
  totalMinor: Schema.Number,
  merchantTimezone: Schema.String,
  customerDetails: Schema.Struct({
    name: Schema.String,
    email: Schema.String,
    phone: Schema.NullOr(Schema.String)
  }),
  checkoutPath: Schema.Literals(['pay_in_person', 'online_payment'])
})
export type AppointmentSnapshot = typeof AppointmentSnapshot.Type
export const OperationalAppointment = Schema.Struct({
  id: Schema.String,
  merchantId: Schema.String,
  providerId: Schema.String,
  status: Schema.Literals(['scheduled', 'completed', 'cancelled', 'no_show']),
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
    ...appointment.snapshot.customerDetails
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
  row.snapshot ? { ...row, snapshot: row.snapshot } : null

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
    return {
      calendar: (date) =>
        Effect.gen(function* () {
          const merchant = yield* MerchantContext
          return calendarProjection(
            yield* list(merchant.id, 'asc'),
            date ?? dateInTimezone(new Date().toISOString(), merchant.timezone),
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
