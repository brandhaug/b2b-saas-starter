import { DateTime } from 'effect'

/** Epoch milliseconds as the ISO string every stored timestamp column holds. */
export function iso(time: number): string {
  return DateTime.formatIso(DateTime.makeUnsafe(time))
}
