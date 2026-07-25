const options = (timeZone: string) => ({ timeZone }) as const
const timeFormatters = new Map<string, Intl.DateTimeFormat>()
const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>()
const calendarDateFormatters = new Map<string, Intl.DateTimeFormat>()

const cachedFormatter = (
  cache: Map<string, Intl.DateTimeFormat>,
  timeZone: string,
  formatterOptions: Intl.DateTimeFormatOptions
) => {
  const existing = cache.get(timeZone)
  if (existing) return existing
  const formatter = Intl.DateTimeFormat(undefined, {
    ...options(timeZone),
    ...formatterOptions
  })
  cache.set(timeZone, formatter)
  return formatter
}

export const formatAppointmentTime = (instant: string, timeZone: string) =>
  cachedFormatter(timeFormatters, timeZone, {
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(instant))

export const formatAppointmentDateTime = (instant: string, timeZone: string) =>
  cachedFormatter(dateTimeFormatters, timeZone, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(instant))

export const dateInTimezone = (instant: Date, timeZone: string) => {
  const existing = calendarDateFormatters.get(timeZone)
  const formatter =
    existing ??
    Intl.DateTimeFormat('en-CA', {
      ...options(timeZone),
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    })
  if (!existing) calendarDateFormatters.set(timeZone, formatter)
  const parts = formatter.formatToParts(instant)
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}
