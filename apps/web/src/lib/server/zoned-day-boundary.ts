import { DateTime, Effect, Option, Schema } from 'effect'

// oxlint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is a curried factory call.
export class InvalidCalendarDay extends Schema.TaggedError<InvalidCalendarDay>()(
  'InvalidCalendarDay',
  { message: Schema.String }
) {}

export const zonedDayBoundary = Effect.fn('Audit.zonedDayBoundary')(function* (
  day: string,
  edge: 'start' | 'end',
  timeZone: string
) {
  const wall = DateTime.make(`${day}T00:00:00.000Z`)
  if (Option.isNone(wall) || DateTime.formatIsoDateUtc(wall.value) !== day) {
    return yield* Effect.fail(
      new InvalidCalendarDay({ message: 'Invalid calendar day' })
    )
  }
  // Compatible chooses the earlier repeated midnight, or advances through a
  // midnight gap. A whole skipped day must not become an adjacent day's filter.
  const options = {
    timeZone,
    adjustForTimeZone: true,
    disambiguation: 'compatible'
  } as const
  const start = DateTime.makeZoned(wall.value, options)
  if (Option.isNone(start) || DateTime.formatIsoDate(start.value) !== day) {
    return yield* Effect.fail(
      new InvalidCalendarDay({
        message: 'Calendar day does not exist in the time zone'
      })
    )
  }
  if (edge === 'start') {
    return DateTime.formatIso(start.value)
  }
  // The next calendar midnight (including a skipped next day) bounds every
  // instant of this day, including repeated end-of-day hours.
  const next = DateTime.makeZonedUnsafe(DateTime.add(wall.value, { days: 1 }), options)
  return DateTime.formatIso(DateTime.subtractDuration(next, 1))
})
