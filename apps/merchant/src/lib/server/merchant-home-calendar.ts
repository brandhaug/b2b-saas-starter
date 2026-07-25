import { createServerFn } from '@tanstack/react-start'
import { Schema } from 'effect'
import { CalendarDate } from '../appointment-calendar-date.ts'
import { readAppointmentCalendar } from './appointment-operations.server.ts'
import {
  requireMerchantSession,
  runMerchantRequestWithSession
} from './merchant-session.ts'

const MerchantHomeInput = Schema.Struct({
  date: Schema.optional(CalendarDate),
  redirectTo: Schema.String
})

export const getMerchantHomeCalendar = createServerFn({ method: 'GET' })
  .validator(Schema.decodeUnknownSync(MerchantHomeInput))
  .handler(async ({ data }) => {
    const session = await requireMerchantSession(data.redirectTo)
    return runMerchantRequestWithSession(session, 'appointment.read', (authorized) =>
      readAppointmentCalendar(authorized.user.id, data.date)
    )
  })
