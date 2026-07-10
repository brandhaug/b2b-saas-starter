const options = (timeZone: string) => ({ timeZone }) as const

export const formatAppointmentTime = (instant: string, timeZone: string) =>
  new Intl.DateTimeFormat(undefined, {
    ...options(timeZone),
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(instant))

export const formatAppointmentDateTime = (instant: string, timeZone: string) =>
  new Intl.DateTimeFormat(undefined, {
    ...options(timeZone),
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(instant))

export const dateInTimezone = (instant: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    ...options(timeZone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(instant)
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}
