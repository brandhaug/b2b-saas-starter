import type {
  ControlledTemplateFacts,
  NotificationPurpose
} from '../notifications/index.ts'

const localParts = (instant: string, timeZone: string, locale: 'ro' | 'en') => {
  const date = new Date(instant)
  const parts = new Intl.DateTimeFormat(locale === 'ro' ? 'ro-RO' : 'en-GB', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date)
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? ''
  return {
    smsDate: `${read('day')}.${read('month')}.${read('year')}`,
    time: `${read('hour')}:${read('minute')}`,
    localizedDate: new Intl.DateTimeFormat(locale === 'ro' ? 'ro-RO' : 'en-GB', {
      timeZone,
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    }).format(date)
  }
}

const compact = (value: string, length: number) => value.trim().slice(0, length)

export const appointmentOperationalNotificationFacts = (input: {
  readonly purpose: NotificationPurpose
  readonly locale: 'ro' | 'en'
  readonly merchantLabel: string
  readonly startsAt: string
  readonly timeZone: string
  readonly appointmentId: string
  readonly confirmationRouteId?: string
}): ControlledTemplateFacts => {
  const local = localParts(input.startsAt, input.timeZone, input.locale)
  return {
    merchantLabel: compact(input.merchantLabel, 40),
    merchantSmsLabel: compact(input.merchantLabel, 24),
    localizedDate: compact(local.localizedDate, 32),
    smsDate: local.smsDate,
    time: local.time,
    locationLabel: compact(input.merchantLabel, 64),
    locationSmsLabel: compact(input.merchantLabel, 28),
    reference: compact(input.appointmentId.replace(/^apt_/, '').toUpperCase(), 12),
    confirmationUrl:
      input.purpose === 'appointment_confirmation' && input.confirmationRouteId
        ? `https://bsolo.ro/c/${compact(input.confirmationRouteId.replace(/^cnf_/, ''), 15)}`
        : ''
  }
}
