import { decodeCalendarDate } from '@/lib/appointment-calendar-date.ts'

export type AppointmentWeekDirection = 'previous' | 'next'
export type AppointmentDayDirection = AppointmentWeekDirection

function shiftCalendarDate(date: string, days: number) {
  const dateOnly = decodeCalendarDate(date)
  const value = new Date(`${dateOnly}T12:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

function mondayOfAppointmentWeek(date: string) {
  const dateOnly = decodeCalendarDate(date)
  const value = new Date(`${dateOnly}T12:00:00.000Z`)
  const mondayOffset = (value.getUTCDay() + 6) % 7
  value.setUTCDate(value.getUTCDate() - mondayOffset)
  return value.toISOString().slice(0, 10)
}

export function appointmentWeekTarget(
  selectedDate: string,
  direction: AppointmentWeekDirection
) {
  return shiftCalendarDate(selectedDate, direction === 'next' ? 7 : -7)
}

export function appointmentDayTarget(
  selectedDate: string,
  direction: AppointmentDayDirection
) {
  return shiftCalendarDate(selectedDate, direction === 'next' ? 1 : -1)
}

export function appointmentWeekDirection(fromDate: string, toDate: string) {
  const fromWeek = mondayOfAppointmentWeek(fromDate)
  const toWeek = mondayOfAppointmentWeek(toDate)
  if (fromWeek === toWeek) return null
  return toWeek > fromWeek ? ('next' as const) : ('previous' as const)
}
