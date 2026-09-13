function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'longOffset'
  }).formatToParts(instant)
  const offset = parts.find((part) => part.type === 'timeZoneName')?.value ?? 'GMT'
  const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(offset)
  if (match === null) {
    return 0
  }
  const [, sign, hours, minutes] = match
  const magnitude = (Number(hours ?? '0') * 60 + Number(minutes ?? '0')) * 60_000
  return sign === '-' ? -magnitude : magnitude
}

export function zonedDayBoundary(
  day: string,
  edge: 'start' | 'end',
  timeZone: string
): string {
  const wall = Date.parse(
    edge === 'start' ? `${day}T00:00:00.000Z` : `${day}T23:59:59.999Z`
  )
  if (!Number.isFinite(wall)) {
    return new Date(0).toISOString()
  }
  const guess = wall - zoneOffsetMs(new Date(wall), timeZone)
  return new Date(wall - zoneOffsetMs(new Date(guess), timeZone)).toISOString()
}
