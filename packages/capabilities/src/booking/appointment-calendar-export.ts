import { Effect, Schema } from 'effect'

export const AppointmentCalendarExportInput = Schema.Struct({
  generatedAt: Schema.String,
  appointmentId: Schema.String,
  appointments: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      status: Schema.Literals(['scheduled', 'completed', 'cancelled', 'no_show']),
      startsAt: Schema.String,
      endsAt: Schema.String,
      snapshot: Schema.Struct({
        services: Schema.Array(Schema.Struct({ name: Schema.String }))
      })
    })
  ),
  shop: Schema.Struct({
    publicName: Schema.String,
    addressLines: Schema.optional(Schema.Array(Schema.String))
  })
})
export type AppointmentCalendarExportInput = typeof AppointmentCalendarExportInput.Type

export class AppointmentCalendarExportUnavailable extends Schema.TaggedErrorClass<AppointmentCalendarExportUnavailable>()(
  'AppointmentCalendarExportUnavailable',
  {
    reason: Schema.Literals(['appointment_not_found', 'invalid_snapshot'])
  }
) {}

type CalendarEventFacts = {
  readonly generatedAt: string
  readonly appointment: {
    readonly id: string
    readonly startsAt: string
    readonly endsAt: string
    readonly snapshot: {
      readonly services: readonly { readonly name: string }[]
    }
  }
  readonly shop: {
    readonly publicName: string
    readonly addressLines?: readonly string[] | undefined
  }
}

const calendarInstant = (instant: string): string =>
  new Date(instant)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')

const calendarText = (value: string): string =>
  value
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')

const safeUidPart = (value: string): string => value.replace(/[^A-Za-z0-9_-]/g, '_')

const foldCalendarLine = (line: string): readonly string[] => {
  const encoder = new TextEncoder()
  const segments: string[] = []
  let segment = ''
  let bytes = 0
  let capacity = 75
  for (const character of line) {
    const characterBytes = encoder.encode(character).byteLength
    if (bytes + characterBytes > capacity && segment) {
      segments.push(segment)
      segment = character
      bytes = characterBytes
      capacity = 74
    } else {
      segment += character
      bytes += characterBytes
    }
  }
  segments.push(segment)
  return segments.map((value, index) => (index === 0 ? value : ` ${value}`))
}

/**
 * Creates a transient RFC 5545 snapshot. The input deliberately excludes Customer
 * Details, credentials, and private Provider facts from the rendered fields.
 */
const renderAppointmentCalendar = (input: CalendarEventFacts): string => {
  const serviceNames = input.appointment.snapshot.services
    .map((service) => service.name.trim())
    .filter(Boolean)
  const subject = `${serviceNames.join(' + ') || 'Appointment'} — ${input.shop.publicName}`
  const location = input.shop.addressLines?.length
    ? input.shop.addressLines.join(', ')
    : input.shop.publicName
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//beesolo//Appointment Calendar Export//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:appointment-${safeUidPart(input.appointment.id)}@beesolo`,
    `DTSTAMP:${calendarInstant(input.generatedAt)}`,
    `DTSTART:${calendarInstant(input.appointment.startsAt)}`,
    `DTEND:${calendarInstant(input.appointment.endsAt)}`,
    `SUMMARY:${calendarText(subject)}`,
    `LOCATION:${calendarText(location)}`,
    'END:VEVENT',
    'END:VCALENDAR'
  ]
    .flatMap(foldCalendarLine)
    .concat('')
    .join('\r\n')
}

export const appointmentCalendarExport = (
  input: AppointmentCalendarExportInput
): Effect.Effect<string, AppointmentCalendarExportUnavailable> => {
  const appointment = input.appointments.find(
    (candidate) =>
      candidate.id === input.appointmentId && candidate.status === 'scheduled'
  )
  if (!appointment)
    return Effect.fail(
      new AppointmentCalendarExportUnavailable({ reason: 'appointment_not_found' })
    )
  const generatedAt = Date.parse(input.generatedAt)
  const startsAt = Date.parse(appointment.startsAt)
  const endsAt = Date.parse(appointment.endsAt)
  if (
    !Number.isFinite(generatedAt) ||
    !Number.isFinite(startsAt) ||
    !Number.isFinite(endsAt) ||
    startsAt >= endsAt
  )
    return Effect.fail(
      new AppointmentCalendarExportUnavailable({ reason: 'invalid_snapshot' })
    )
  return Effect.try({
    try: () =>
      renderAppointmentCalendar({
        generatedAt: input.generatedAt,
        appointment,
        shop: input.shop
      }),
    catch: () =>
      new AppointmentCalendarExportUnavailable({ reason: 'invalid_snapshot' })
  })
}
