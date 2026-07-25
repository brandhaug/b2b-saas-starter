import { env } from 'cloudflare:workers'
import { Effect, Layer } from 'effect'
import { layerFromD1 } from '@b2b-saas-starter/db'
import { AppointmentOperations } from '@b2b-saas-starter/capabilities/booking'
import {
  liveMerchantContext,
  MerchantContext
} from '@b2b-saas-starter/capabilities/merchant-catalog'
import { selectCapabilitiesLayer } from '@b2b-saas-starter/capabilities/runtime'

const run = async <A>(
  userId: string,
  effect: Effect.Effect<A, unknown, AppointmentOperations | MerchantContext>
) => {
  if (!env.DB)
    throw new Error('Appointment Operations requires the Merchant App D1 binding.')
  const context = liveMerchantContext(userId).pipe(Layer.provide(layerFromD1(env.DB)))
  return Effect.runPromise(
    Effect.provide(
      effect,
      Layer.merge(selectCapabilitiesLayer({ DB: env.DB }), context)
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

export const readCustomerDirectory = (userId: string) =>
  run(
    userId,
    Effect.flatMap(AppointmentOperations, (operations) => operations.customers())
  )
