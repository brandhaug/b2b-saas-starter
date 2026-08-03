import { parseBookingLocale } from '../localization/booking-localization.ts'
import type { BookingEmbedding } from './booking-route-contract.ts'

export const validateBookingLandingSearch = (search: Record<string, unknown>) => {
  const locale = parseBookingLocale(
    typeof search.locale === 'string' ? search.locale : undefined
  )
  const embed =
    search.embed === 'widget' || search.embed === 'google'
      ? (search.embed as BookingEmbedding)
      : null
  return {
    ...(typeof search.booking === 'string' ? { booking: search.booking } : {}),
    ...(locale ? { locale } : {}),
    ...(embed ? { embed } : {})
  }
}
