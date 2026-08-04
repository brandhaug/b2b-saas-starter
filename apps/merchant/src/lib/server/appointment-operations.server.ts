import { env } from 'cloudflare:workers'
import { Effect, Layer } from 'effect'
import { layerFromD1 } from '@b2b-saas-starter/db'
import {
  AppointmentOperations,
  MerchantAppointmentCommands,
  type MerchantAppointmentCommand,
  type MerchantAppointmentSeriesPreviewInput
} from '@b2b-saas-starter/capabilities/booking'
import {
  liveMerchantContext,
  MerchantContext
} from '@b2b-saas-starter/capabilities/merchant-catalog'
import { selectCapabilitiesLayer } from '@b2b-saas-starter/capabilities/runtime'
import { merchantCapabilitiesEnv } from './capabilities-env.server.ts'

const run = async <A>(
  userId: string,
  effect: Effect.Effect<
    A,
    unknown,
    AppointmentOperations | MerchantAppointmentCommands | MerchantContext
  >,
  impersonatedBy: string | null = null
) => {
  if (!env.DB)
    throw new Error('Appointment Operations requires the Merchant App D1 binding.')
  const context = liveMerchantContext(userId).pipe(Layer.provide(layerFromD1(env.DB)))
  return Effect.runPromise(
    Effect.provide(
      effect,
      Layer.mergeAll(
        selectCapabilitiesLayer(merchantCapabilitiesEnv(), {
          merchantAppointmentImpersonatedBy: impersonatedBy
        }),
        context
      )
    )
  )
}

export const readAppointmentCalendar = (userId: string, date?: string) =>
  run(
    userId,
    Effect.flatMap(AppointmentOperations, (operations) => operations.calendar(date))
  )

export const readAppointmentDetail = (userId: string, appointmentId: string) =>
  run(
    userId,
    Effect.flatMap(AppointmentOperations, (operations) =>
      operations.detail(appointmentId)
    )
  )

export const executeAppointmentCommand = (
  userId: string,
  command: MerchantAppointmentCommand,
  impersonatedBy: string | null
) =>
  run(
    userId,
    Effect.flatMap(MerchantAppointmentCommands, (operations) =>
      operations.execute(command)
    ),
    impersonatedBy
  )

export const readAppointmentHistory = (userId: string, appointmentId: string) =>
  run(
    userId,
    Effect.flatMap(MerchantAppointmentCommands, (operations) =>
      operations.history(appointmentId)
    )
  )

export const previewAppointmentSeries = (
  userId: string,
  input: MerchantAppointmentSeriesPreviewInput
) =>
  run(
    userId,
    Effect.flatMap(MerchantAppointmentCommands, (operations) =>
      operations.previewSeries(input)
    )
  )
