import { intlLocale, type Locale } from './locale.ts'

export type DateInput = Date | number | string

const DEFAULT_DATE_OPTIONS: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }
const DEFAULT_DATE_TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  dateStyle: 'medium',
  timeStyle: 'short'
}

/** Format a date with an explicit locale and time zone (UTC by default). */
export function formatDate(
  value: DateInput,
  locale: Locale,
  options: Intl.DateTimeFormatOptions = DEFAULT_DATE_OPTIONS,
  timeZone = 'UTC'
): string {
  let effectiveTimeZone = timeZone
  if (isCalendarDate(value)) {
    // Calendar dates have no time zone. Rendering their UTC midnight in the
    // caller's zone would move the date for western offsets.
    effectiveTimeZone = 'UTC'
  }
  const date = dateValue(value)
  const { dateStyle, timeStyle, ...fields } = options
  const zonedFields = { ...fields, timeZone: effectiveTimeZone }
  if (dateStyle !== undefined && timeStyle !== undefined) {
    // ICU versions disagree on combined-style connectors (", " versus " at "
    // in English). Both supported locales use a comma here. Format the two
    // localized parts independently so SSR and browser hydration agree while
    // retaining the requested styles, timezone and hour cycle.
    const day = dateLabel(date, locale, {
      ...zonedFields,
      dateStyle
    })
    const time = dateLabel(date, locale, {
      ...zonedFields,
      timeStyle
    })
    return `${day}, ${time}`
  }
  return dateLabel(date, locale, {
    ...options,
    timeZone: effectiveTimeZone
  })
}

/** Format a date and time with a stable, explicit locale and time zone. */
export function formatDateTime(
  value: DateInput,
  locale: Locale,
  options: Intl.DateTimeFormatOptions = DEFAULT_DATE_TIME_OPTIONS,
  timeZone = 'UTC'
): string {
  return formatDate(value, locale, options, timeZone)
}

/** Format a numeric value using the locale's decimal conventions. */
export function formatNumber(
  value: number,
  locale: Locale,
  options: Intl.NumberFormatOptions = {}
): string {
  return new Intl.NumberFormat(intlLocale(locale), options).format(value)
}

/** Format money while preserving the amount's actual currency. */
export function formatCurrency(
  value: number,
  currency: string,
  locale: Locale,
  options: Omit<Intl.NumberFormatOptions, 'style' | 'currency'> = {}
): string {
  return new Intl.NumberFormat(intlLocale(locale), {
    ...options,
    style: 'currency',
    currency
  }).format(value)
}

function dateValue(value: DateInput): Date {
  // oxlint-disable-next-line unicorn/no-instanceof-builtins -- DateInput accepts Date values from any application realm
  if (value instanceof Date) {
    // oxlint-disable-next-line effect/noGlobals -- formatting is an explicitly requested pure presentation operation
    return new Date(value)
  }
  if (isCalendarDate(value)) {
    // oxlint-disable-next-line effect/noGlobals -- formatting is an explicitly requested pure presentation operation
    return new Date(`${value}T00:00:00.000Z`)
  }
  // oxlint-disable-next-line effect/noGlobals -- formatting is an explicitly requested pure presentation operation
  return new Date(value)
}

function isCalendarDate(value: DateInput): value is string {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- DateInput is the public formatting boundary
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value)
}

function dateLabel(
  date: Date,
  locale: Locale,
  options: Intl.DateTimeFormatOptions
): string {
  return new Intl.DateTimeFormat(intlLocale(locale), options).format(date)
}
