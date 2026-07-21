import { createServerFn } from '@tanstack/react-start'
import { Schema } from 'effect'
import { CalendarDate } from '../appointment-calendar-date.ts'
import { getAppointmentCalendar } from './appointment-operations.ts'
import { requireMerchantSession } from './merchant-session.ts'

const MobileSheetUnderlayInput = Schema.Struct({
  date: Schema.optional(CalendarDate),
  redirectTo: Schema.String
})

export const getMobileSheetUnderlayCalendar = createServerFn({ method: 'GET' })
  .validator(Schema.decodeUnknownSync(MobileSheetUnderlayInput))
  .handler(async ({ data }) => {
    await requireMerchantSession(data.redirectTo)
    return getAppointmentCalendar({ data: { date: data.date } })
  })
