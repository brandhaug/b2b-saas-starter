import { createServerFn } from '@tanstack/react-start'
import { Schema } from 'effect'
import {
  type AppointmentDetailResult,
  type CustomerDirectory
} from '@b2b-saas-starter/capabilities/booking'
import { runMerchantRequest } from './merchant-session.ts'
import {
  readAppointmentDetail,
  readCustomerDirectory
} from './appointment-operations.server.ts'

const DetailInput = Schema.Struct({ appointmentId: Schema.String })

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
