import { formatDate } from '@b2b-saas-starter/i18n/format'
import { getLocale } from '@b2b-saas-starter/i18n/runtime'
import { presentationSettings } from './i18n'

// Explicit locale and zone keep the server render and browser hydration identical.

/**
 * An instant, rendered the one way the app shows time: medium date, short
 * time, and the display zone ("May 16, 2026, 7:30 AM UTC").
 */
export function formatTimestamp(value: Date | string): string {
  const { timeZone } = presentationSettings()
  return `${formatDate(value, getLocale(), { dateStyle: 'medium', timeStyle: 'short' }, timeZone)} ${timeZone}`
}

export function formatTimestampOr(
  value: Date | string | null | undefined,
  fallback: string
): string {
  return value === null || value === undefined ? fallback : formatTimestamp(value)
}

/** The day an instant falls on in the display zone, without a time. */
export function formatCalendarDate(
  value: Date | string,
  dateStyle: 'short' | 'medium' = 'medium'
): string {
  return formatDate(value, getLocale(), { dateStyle }, presentationSettings().timeZone)
}
