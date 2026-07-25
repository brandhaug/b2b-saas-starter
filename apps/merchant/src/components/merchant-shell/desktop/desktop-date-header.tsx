import { decodeCalendarDate } from '@/lib/appointment-calendar-date.ts'

const desktopDateFormatter = new Intl.DateTimeFormat('en', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  timeZone: 'UTC'
})

export function DesktopDateHeader({
  date,
  currentDate
}: {
  readonly date: string
  readonly currentDate: string
}) {
  const dateOnly = decodeCalendarDate(date)
  const value = new Date(`${dateOnly}T12:00:00.000Z`)
  const parts = new Map(
    desktopDateFormatter
      .formatToParts(value)
      .flatMap((part) =>
        part.type === 'literal' ? [] : [[part.type, part.value] as const]
      )
  )
  const weekday = parts.get('weekday')
  const monthAndDay = `${parts.get('month')} ${parts.get('day')}`
  const current = dateOnly === decodeCalendarDate(currentDate)

  return (
    <div
      data-desktop-date-header="true"
      className="relative flex h-12 items-center justify-center pb-2"
    >
      <p className="flex min-w-0 items-center justify-center gap-2 whitespace-nowrap text-sm font-semibold tracking-[-0.01em] text-muted-foreground">
        <span>{weekday}</span>
        <span aria-hidden>·</span>
        <span className="tabular-nums">{monthAndDay}</span>
      </p>
      <span
        aria-hidden
        data-current-day-marker={current ? 'true' : undefined}
        data-current-day-marker-slot="true"
        className={`absolute bottom-0 left-1/2 size-1.5 -translate-x-1/2 rounded-full bg-primary ${current ? '' : 'invisible'}`}
      />
    </div>
  )
}
