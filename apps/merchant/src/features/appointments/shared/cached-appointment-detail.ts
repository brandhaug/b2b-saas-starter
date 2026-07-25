import type { QueryClient } from '@tanstack/react-query'
import type {
  OperationalAppointment,
  ProviderCalendar
} from '@b2b-saas-starter/capabilities/booking'

const merchantCalendarQueryPrefix = ['merchant-home', 'calendar'] as const

export function cachedAppointmentDetail(
  queryClient: QueryClient,
  appointmentId: string
): OperationalAppointment | undefined {
  const calendars = queryClient.getQueriesData<ProviderCalendar>({
    queryKey: merchantCalendarQueryPrefix
  })

  for (const [, calendar] of calendars) {
    if (!calendar) continue
    for (const provider of calendar.providers) {
      const appointment = provider.appointments.find(
        (candidate) => candidate.id === appointmentId
      )
      if (appointment) return appointment
    }
  }

  return undefined
}
