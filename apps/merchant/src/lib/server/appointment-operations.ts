import { createServerFn } from '@tanstack/react-start'
import { Schema } from 'effect'
import {
  MerchantAppointmentCommandSchema,
  MerchantAppointmentSeriesPreviewSchema,
  type AppointmentDetailResult,
  type AppointmentOperationHistoryEntry,
  type MerchantAppointmentCommandResult
} from '@b2b-saas-starter/capabilities/booking'
import { runMerchantRequest } from './merchant-session.ts'
import {
  executeAppointmentCommand,
  previewAppointmentSeries as previewAppointmentSeriesOnServer,
  readAppointmentDetail,
  readAppointmentHistory
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

export const runAppointmentCommand = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(MerchantAppointmentCommandSchema))
  .handler(
    async ({ data }): Promise<MerchantAppointmentCommandResult> =>
      runMerchantRequest('appointment.update', (session) =>
        executeAppointmentCommand(
          session.user.id,
          data,
          session.session.impersonatedBy ?? null
        )
      )
  )

export const getAppointmentHistory = createServerFn({ method: 'GET' })
  .validator(Schema.decodeUnknownSync(DetailInput))
  .handler(
    async ({ data }): Promise<readonly AppointmentOperationHistoryEntry[]> =>
      runMerchantRequest('appointment.read', (session) =>
        readAppointmentHistory(session.user.id, data.appointmentId)
      )
  )

export const previewAppointmentSeries = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(MerchantAppointmentSeriesPreviewSchema))
  .handler(({ data }) =>
    runMerchantRequest('appointment.update', (session) =>
      previewAppointmentSeriesOnServer(session.user.id, data)
    )
  )
