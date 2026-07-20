import { mobileDateHeading } from './mobile-appointments-model.ts'

export function MobileDateHero({
  date,
  timezone
}: {
  readonly date: string
  readonly timezone: string
}) {
  const heading = mobileDateHeading(date)
  const [weekday, ...rest] = heading.fullDate.split(', ')
  return (
    <header className="flex items-end justify-between gap-6">
      <div className="flex items-center gap-4">
        <h1 className="text-[6.5rem] leading-[0.8] font-black tracking-[-0.08em] text-foreground">
          {heading.day}
        </h1>
        <span className="mt-8 size-7 shrink-0 rounded-full bg-primary" aria-hidden />
      </div>
      <div className="pb-1 text-right">
        <p className="text-xl leading-tight font-bold text-muted-foreground">
          {weekday}
        </p>
        <p className="text-xl leading-tight font-bold text-muted-foreground">
          {rest.join(', ')}
        </p>
        <p className="mt-2 text-[0.65rem] font-semibold tracking-[0.12em] text-muted-foreground/70 uppercase">
          {timezone}
        </p>
      </div>
    </header>
  )
}
