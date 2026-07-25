import { decodeAppointmentCalendarSearch } from './appointment-calendar-date.ts'
import { merchantHomeDateFromNavigationState } from './merchant-home-route.ts'

export function merchantHomeDate(search: unknown, state: unknown) {
  try {
    return (
      decodeAppointmentCalendarSearch(search).date ??
      merchantHomeDateFromNavigationState(state)
    )
  } catch {
    return undefined
  }
}
