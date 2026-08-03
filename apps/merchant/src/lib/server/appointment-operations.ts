import { createServerFn } from '@tanstack/react-start'
import { Schema } from 'effect'
import { type AppointmentDetailResult } from '@b2b-saas-starter/capabilities/booking'
import { runMerchantRequest } from './merchant-session.ts'
import { readAppointmentDetail } from './appointment-operations.server.ts'

const DetailInput = Schema.Struct({ appointmentId: Schema.String })

export const getAppointmentDetail = createServerFn({ method: 'GET' })
  .validator(Schema.decodeUnknownSync(DetailInput))
  .handler(
    async ({ data }): Promise<AppointmentDetailResult> =>
      runMerchantRequest('customer.read', (session) =>
        readAppointmentDetail(session.user.id, data.appointmentId)
      )
  )
