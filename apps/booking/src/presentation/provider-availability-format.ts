import type { BookingLocale } from '../localization/booking-localization.ts'

const localCalendarDate = (instant: string | Date, timezone: string) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(typeof instant === 'string' ? new Date(instant) : instant)
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)!.value
  return `${read('year')}-${read('month')}-${read('day')}`
}

export const formatProviderAvailability = (
  startsAt: string,
  timezone: string,
  locale: BookingLocale,
  now = new Date()
) => {
  const fromDate = localCalendarDate(now, timezone)
  const targetDate = localCalendarDate(startsAt, timezone)
  const dayDifference = Math.round(
    (Date.parse(`${targetDate}T12:00:00.000Z`) -
      Date.parse(`${fromDate}T12:00:00.000Z`)) /
      86_400_000
  )
  if (dayDifference <= 1) {
    const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(
      dayDifference,
      'day'
    )
    return relative.charAt(0).toLocaleUpperCase(locale) + relative.slice(1)
  }
  return new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    weekday: 'long',
    month: 'short',
    day: 'numeric'
  }).format(new Date(startsAt))
}
