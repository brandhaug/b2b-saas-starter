import { Schema } from 'effect'

const calendarDatePattern = /^\d{4}-\d{2}-\d{2}$/

function isCalendarDate(value: string) {
  if (!calendarDatePattern.test(value)) return false

  const parsed = new Date(`${value}T12:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

export const CalendarDate = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter<string>(
      (value) => isCalendarDate(value) || 'Expected a valid calendar date (YYYY-MM-DD)',
      { identifier: 'CalendarDate' }
    )
  )
)

export const AppointmentCalendarSearch = Schema.Struct({
  date: Schema.optional(CalendarDate)
})

export const decodeAppointmentCalendarSearch = Schema.decodeUnknownSync(
  AppointmentCalendarSearch
)

export const decodeCalendarDate = Schema.decodeUnknownSync(CalendarDate)
