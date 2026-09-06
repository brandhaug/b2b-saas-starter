import { formatDate } from '@b2b-saas-starter/i18n/format'
import { getLocale } from '@b2b-saas-starter/i18n/runtime'
import { presentationSettings } from './i18n'

/** Explicit settings keep the server render and browser hydration identical. */
export function formatTimestamp(
  value: Date | string,
  format: Intl.DateTimeFormatOptions = {}
): string {
  const options =
    Object.keys(format).length === 0
      ? ({
          year: 'numeric',
          month: 'numeric',
          day: 'numeric',
          hour: 'numeric',
          minute: 'numeric',
          second: 'numeric'
        } satisfies Intl.DateTimeFormatOptions)
      : format
  return formatDate(value, getLocale(), options, presentationSettings().timeZone)
}

export function formatTimestampOr(
  value: Date | string | null | undefined,
  fallback: string,
  format: Intl.DateTimeFormatOptions = {}
): string {
  return value === null || value === undefined
    ? fallback
    : formatTimestamp(value, format)
}

export function formatDateTime(value: Date | string): string {
  return `${formatTimestamp(value, { dateStyle: 'medium', timeStyle: 'short' })} ${presentationSettings().timeZone}`
}
