export type MobileCalendarDay = {
  readonly date: string
  readonly day: number
  readonly selected: boolean
}

const calendarMonthFormatter = new Intl.DateTimeFormat('en', {
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC'
})

const calendarMonthNameFormatter = new Intl.DateTimeFormat('en', {
  month: 'short',
  timeZone: 'UTC'
})

export const calendarDate = (date: Date) => date.toISOString().slice(0, 10)
export const monthAnchor = (date: string) => `${date.slice(0, 7)}-01`

export function mobileCalendarMonth(visibleDate: string, selectedDate = visibleDate) {
  const anchor = new Date(`${monthAnchor(visibleDate)}T12:00:00.000Z`)
  const year = anchor.getUTCFullYear()
  const month = anchor.getUTCMonth()
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0, 12)).getUTCDate()
  const days: MobileCalendarDay[] = Array.from({ length: daysInMonth }, (_, index) => {
    const value = new Date(Date.UTC(year, month, index + 1, 12))
    const valueDate = calendarDate(value)
    return {
      date: valueDate,
      day: value.getUTCDate(),
      selected: valueDate === selectedDate
    }
  })

  const adjacentMonth = (offset: number) => {
    const value = new Date(Date.UTC(year, month + offset, 1, 12))
    return calendarDate(value)
  }

  return {
    label: calendarMonthFormatter.format(anchor),
    monthName: calendarMonthNameFormatter.format(anchor),
    year,
    leadingBlankDays: (anchor.getUTCDay() + 6) % 7,
    previousMonth: adjacentMonth(-1),
    nextMonth: adjacentMonth(1),
    days
  }
}
