import { motion } from 'motion/react'
import { SmartAnimateText } from '@/components/ui/smart-text-animate.tsx'
import { mobileDateHeading } from './mobile-appointments-model.ts'

export function MobileDateHero({
  date,
  currentDate,
  timezone: _timezone
}: {
  readonly date: string
  readonly currentDate: string
  readonly timezone: string
}) {
  const heading = mobileDateHeading(date)
  const [weekday = 'Selected day', ...rest] = heading.fullDate.split(', ')
  const isCurrentDay = date === currentDate
  return (
    <header
      data-date-hero-layout="mobile"
      className="flex items-end justify-between gap-6 px-1.5"
    >
      <div className="flex items-center gap-1">
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
        <motion.span
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
      </div>
      <div className="pb-1 text-right">
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
      </div>
    </header>
  )
}
