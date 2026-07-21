import { Link } from '@tanstack/react-router'
import { mobileWeek } from './mobile-appointments-model.ts'

export function MobileWeekStrip({
  selectedDate,
  currentDate
}: {
  readonly selectedDate: string
  readonly currentDate: string
}) {
  return (
    <nav aria-label="Appointment week" className="mt-8 grid grid-cols-7 gap-1">
      {mobileWeek(selectedDate, currentDate).map((day) => (
        <Link
          key={day.date}
          to="/appointments"
          search={{ date: day.date }}
          aria-current={day.selected ? 'date' : undefined}
          className={`relative grid min-h-20 place-content-center rounded-2xl text-center transition-colors ${day.selected ? 'bg-card text-foreground' : 'text-muted-foreground hover:bg-card/60'}`}
        >
          {day.current ? (
            <span
              data-current-day-marker="true"
              className="absolute top-2 left-1/2 size-1.5 -translate-x-1/2 rounded-full bg-primary"
              aria-hidden
            />
          ) : null}
          <span className="text-xl font-bold tabular-nums">{day.day}</span>
          <span
            className={`mt-1 text-[0.65rem] font-bold tracking-[0.08em] uppercase ${day.selected ? 'text-foreground' : ''}`}
          >
            {day.weekday}
          </span>
        </Link>
      ))}
    </nav>
  )
}
