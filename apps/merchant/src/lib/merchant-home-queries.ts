import { keepPreviousData, queryOptions } from '@tanstack/react-query'
import { getMerchantHomeCalendar } from './server/merchant-home-calendar.ts'
import { getMerchantPublicBookingUrl } from './server/merchant-onboarding.ts'

export const merchantHomeCalendarQueryKey = (date: string | undefined) =>
  ['merchant-home', 'calendar', date ?? 'today'] as const

export const merchantHomeCalendarQuery = (
  date: string | undefined,
  redirectTo: string
) =>
  queryOptions({
    queryKey: merchantHomeCalendarQueryKey(date),
    queryFn: () =>
      getMerchantHomeCalendar({
        data: { date, redirectTo }
      }),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    throwOnError: true
  })

export const merchantPublicBookingUrlQuery = () =>
  queryOptions({
    queryKey: ['merchant-home', 'public-booking-url'] as const,
    queryFn: async () => (await getMerchantPublicBookingUrl()) ?? null,
    staleTime: 5 * 60_000,
    throwOnError: true
  })
