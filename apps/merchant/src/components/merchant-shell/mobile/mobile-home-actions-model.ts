export const mobileCalendarDockAction = (
  selectedDate: string,
  currentDate: string
): 'open-calendar' | 'return-today' =>
  selectedDate === currentDate ? 'open-calendar' : 'return-today'
