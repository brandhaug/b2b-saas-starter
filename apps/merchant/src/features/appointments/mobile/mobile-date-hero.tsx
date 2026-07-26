import { m } from 'motion/react'
import { SmartAnimateText } from '@/components/ui/smart-text-animate.tsx'
import { mobileDateHeading } from './mobile-appointments-model.ts'

export function MobileDateHero({
  date,
  currentDate,
  timezone: _timezone,
  calendarOpen,
  onOpenCalendar,
  onReturnToCurrentDay
}: {
  readonly date: string
  readonly currentDate: string
  readonly timezone: string
  readonly calendarOpen: boolean
  readonly onOpenCalendar: () => void
  readonly onReturnToCurrentDay: () => void
}) {
  const heading = mobileDateHeading(date)
  const [weekday = 'Selected day', ...rest] = heading.fullDate.split(', ')
  const isCurrentDay = date === currentDate
  return (
    <header
      data-date-hero-layout="mobile"
      className="flex items-end justify-between gap-6 px-1.5"
    >
      <button
        type="button"
        aria-label="Return to today"
        aria-current={isCurrentDay ? 'date' : undefined}
        data-mobile-date-current-day-trigger="true"
        className="flex min-h-11 min-w-11 items-center gap-1 rounded-xl text-left transition-transform active:scale-[0.98]"
        onClick={onReturnToCurrentDay}
      >
        {/* <h1 className="text-[4rem] leading-[0.8] font-black text-foreground">
          {heading.day}
        </h1> */}
        <SmartAnimateText
          value={heading.day}
          gap={0}
          enterStiffness={150}
          enterBlur={16}
          digitClassName="text-[4rem] leading-[0.8] font-black text-foreground"
        />
        <m.span
          data-current-day-marker={isCurrentDay ? 'true' : undefined}
          data-current-day-marker-slot="true"
          data-current-day-marker-state={isCurrentDay ? 'visible' : 'hidden'}
          initial={{ opacity: 0, scale: 0.7, filter: 'blur(6px)' }}
          animate={{
            opacity: isCurrentDay ? 1 : 0,
            scale: isCurrentDay ? 1 : 0.7,
            filter: isCurrentDay ? 'blur(0px)' : 'blur(6px)'
          }}
          transition={{
            type: 'spring',
            stiffness: 150,
            damping: 10,
            delay: 0.04
          }}
          className="mt-1 ml-2 size-6 shrink-0 rounded-full bg-primary"
          aria-hidden
        />
      </button>
      <button
        type="button"
        aria-label={`Open calendar for ${heading.fullDate}`}
        aria-haspopup="dialog"
        aria-expanded={calendarOpen}
        data-mobile-date-calendar-trigger="true"
        className="flex min-h-11 min-w-11 flex-col items-end justify-end rounded-xl pb-1 text-right transition-transform active:scale-[0.98]"
        onClick={onOpenCalendar}
      >
        {/* <p className="text-xl leading-tight font-bold text-foreground">
          {weekday}
        </p> */}
        <SmartAnimateText
          value={weekday}
          gap={0}
          enterStiffness={150}
          enterBlur={16}
          className="text-xl leading-tight font-bold text-foreground"
        />
        <p className="text-xl leading-tight font-bold text-muted-foreground">
          {rest.join(', ')}
        </p>
        {/* <p className="mt-2 text-[0.65rem] font-semibold tracking-[0.12em] text-muted-foreground/70 uppercase">
          {timezone}
        </p> */}
      </button>
    </header>
  )
}
