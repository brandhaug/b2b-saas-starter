/**
 * UTC date formatting, in one place.
 *
 * Every timestamp the app renders is formatted with an explicit locale and an
 * explicit `UTC` time zone: the server and the browser sit in different zones,
 * and a value formatted in the ambient zone hydrates to different text than it
 * server-rendered. Panels each carried their own copy of that two-line rule;
 * this is the rule.
 */

const LOCALE = 'en-US'

/** A timestamp in UTC. `format` selects the fields, exactly as `Intl` does. */
export function formatUtc(
  value: Date | string,
  format: Intl.DateTimeFormatOptions = {}
): string {
  return new Date(value).toLocaleString(LOCALE, { ...format, timeZone: 'UTC' })
}

/**
 * The same, for a value that may be absent — `fallback` is the copy shown in
 * its place ("never" for a token that was minted but never used).
 */
export function formatUtcOr(
  value: Date | string | null | undefined,
  fallback: string,
  format: Intl.DateTimeFormatOptions = {}
): string {
  return value === null || value === undefined ? fallback : formatUtc(value, format)
}
