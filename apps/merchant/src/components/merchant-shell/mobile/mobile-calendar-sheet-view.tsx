import type { PointerEventHandler, RefObject } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { mobileCalendarMonth } from './mobile-calendar-model.ts'

const calendarDayLabel = new Intl.DateTimeFormat('en', {
  dateStyle: 'full',
  timeZone: 'UTC'
})

export function MobileCalendarSheetView({
  dialogRef,
  panelRef,
  titleId,
  sheetState,
  month,
  currentDate,
  requestClose,
  chooseDate,
  changeMonth,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel
}: {
  readonly dialogRef: RefObject<HTMLDialogElement | null>
  readonly panelRef: RefObject<HTMLElement | null>
  readonly titleId: string
  readonly sheetState: string
  readonly month: ReturnType<typeof mobileCalendarMonth>
  readonly currentDate: string
  readonly requestClose: (initialVelocity?: number) => void
  readonly chooseDate: (date: string) => void
  readonly changeMonth: (date: string) => void
  readonly onPointerDown: PointerEventHandler<HTMLElement>
  readonly onPointerMove: PointerEventHandler<HTMLElement>
  readonly onPointerUp: PointerEventHandler<HTMLElement>
  readonly onPointerCancel: PointerEventHandler<HTMLElement>
}) {
  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      data-calendar-sheet-state={sheetState}
      className="merchant-more-dialog merchant-calendar-dialog"
      onCancel={(event) => {
        event.preventDefault()
        requestClose()
      }}
    >
      <button
        type="button"
        aria-label="Close calendar"
        className="merchant-more-dismiss"
        onClick={() => requestClose()}
      />
      <section
        ref={panelRef}
        className="merchant-more-panel merchant-calendar-panel merchant-floating-sheet-panel touch-pan-x"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        <header className="flex items-center justify-between gap-2 px-4 pt-5 pb-3">
          <h2
            id={titleId}
            className="whitespace-nowrap text-xl leading-7 font-semibold"
          >
            {month.monthName}{' '}
            <span className="text-muted-foreground">{month.year}</span>
          </h2>
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Previous month"
              className="grid size-10 place-items-center rounded-full text-muted-foreground active:bg-muted"
              onClick={() => changeMonth(month.previousMonth)}
            >
              <ChevronLeft aria-hidden className="size-5" strokeWidth={2} />
            </button>
            <button
              type="button"
              className="min-h-10 rounded-full px-2 text-sm font-semibold text-muted-foreground active:bg-muted"
              onClick={() => chooseDate(currentDate)}
            >
              Today
            </button>
            <button
              type="button"
              aria-label="Next month"
              className="grid size-10 place-items-center rounded-full text-muted-foreground active:bg-muted"
              onClick={() => changeMonth(month.nextMonth)}
            >
              <ChevronRight aria-hidden className="size-5" strokeWidth={2} />
            </button>
          </div>
        </header>
        <div className="grid grid-cols-7 px-4 text-center text-xs font-semibold text-muted-foreground uppercase">
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((weekday, index) => (
            <span key={`${weekday}-${index}`} className="py-3">
              {weekday}
            </span>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-y-1 px-4 pb-6">
          {Array.from({ length: month.leadingBlankDays }, (_, index) => (
            <span key={`blank-${index}`} aria-hidden className="size-10" />
          ))}
          {month.days.map((day) => {
            const isCurrentDate = day.date === currentDate
            return (
              <button
                key={day.date}
                type="button"
                aria-label={calendarDayLabel.format(
                  new Date(`${day.date}T12:00:00.000Z`)
                )}
                aria-current={isCurrentDate ? 'date' : undefined}
                aria-pressed={day.selected}
                className={`mx-auto grid size-10 place-items-center rounded-full text-base font-medium tabular-nums active:scale-95 ${
                  day.selected
                    ? 'bg-primary text-primary-foreground'
                    : isCurrentDate
                      ? 'text-foreground ring-2 ring-primary ring-inset active:bg-muted'
                      : 'text-foreground active:bg-muted'
                }`}
                onClick={() => chooseDate(day.date)}
              >
                {day.day}
              </button>
            )
          })}
        </div>
      </section>
    </dialog>
  )
}
