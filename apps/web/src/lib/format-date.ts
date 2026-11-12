import { formatDate } from '@b2b-saas-starter/i18n/format'
import { getLocale } from '@b2b-saas-starter/i18n/runtime'
import { presentationSettings } from './i18n'

/**
 * Explicit settings keep the server render and browser hydration identical.
 * Without `format`, an instant renders like every other timestamp in the app:
 * medium date, short time, and the display zone ("May 16, 2026, 7:30 AM UTC").
 */
export function formatTimestamp(
  value: Date | string,
  format?: Intl.DateTimeFormatOptions
): string {
  const { timeZone } = presentationSettings()
  return format === undefined
    ? `${formatDate(value, getLocale(), { dateStyle: 'medium', timeStyle: 'short' }, timeZone)} ${timeZone}`
    : formatDate(value, getLocale(), format, timeZone)
}

export function formatTimestampOr(
  value: Date | string | null | undefined,
  fallback: string,
  format?: Intl.DateTimeFormatOptions
): string {
  return value === null || value === undefined
    ? fallback
    : formatTimestamp(value, format)
}
