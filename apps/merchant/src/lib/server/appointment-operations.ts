import { createServerFn } from '@tanstack/react-start'
import { Schema } from 'effect'
import {
  type AppointmentDetailResult,
  type CustomerDirectory,
  type ProviderCalendar
} from '@b2b-saas-starter/capabilities/booking'
import { CalendarDate } from '../appointment-calendar-date.ts'
import { runMerchantRequest } from './merchant-session.ts'
import {
  readAppointmentCalendar,
  readAppointmentDetail,
  readCustomerDirectory
} from './appointment-operations.server.ts'

const DateInput = Schema.Struct({ date: Schema.optional(CalendarDate) })
const DetailInput = Schema.Struct({ appointmentId: Schema.String })

export const getAppointmentCalendar = createServerFn({ method: 'GET' })
  .validator(Schema.decodeUnknownSync(DateInput))
  .handler(
    async ({ data }): Promise<ProviderCalendar> =>
      runMerchantRequest('appointment.read', (session) =>
        readAppointmentCalendar(session.user.id, data.date)
      )
  )

export const getAppointmentDetail = createServerFn({ method: 'GET' })
  .validator(Schema.decodeUnknownSync(DetailInput))
  .handler(
    async ({ data }): Promise<AppointmentDetailResult> =>
      runMerchantRequest('customer.read', (session) =>
        readAppointmentDetail(session.user.id, data.appointmentId)
      )
  )

export const getCustomerDirectory = createServerFn({ method: 'GET' }).handler(
  async (): Promise<CustomerDirectory> =>
    runMerchantRequest('customer.read', (session) =>
      readCustomerDirectory(session.user.id)
    )
)
