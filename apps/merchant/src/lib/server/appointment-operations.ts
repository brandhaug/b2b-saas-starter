import { env } from 'cloudflare:workers'
import { createServerFn } from '@tanstack/react-start'
import { Effect, Layer, Schema } from 'effect'
import { layerFromD1 } from '@b2b-saas-starter/db'
import {
  AppointmentOperations,
  type AppointmentDetailResult,
  type CustomerDirectory,
  type ProviderCalendar
} from '@b2b-saas-starter/capabilities/booking'
import {
  liveMerchantContext,
  MerchantContext
} from '@b2b-saas-starter/capabilities/merchant-catalog'
import { selectCapabilitiesLayer } from '@b2b-saas-starter/capabilities/runtime'
import { runMerchantRequest } from './merchant-session.ts'

const DateInput = Schema.Struct({ date: Schema.optional(Schema.String) })
const DetailInput = Schema.Struct({ appointmentId: Schema.String })

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

export const getAppointmentCalendar = createServerFn({ method: 'GET' })
  .validator(Schema.decodeUnknownSync(DateInput))
  .handler(
    async ({ data }): Promise<ProviderCalendar> =>
      runMerchantRequest('appointment.read', (session) =>
        run(
          session.user.id,
          Effect.flatMap(AppointmentOperations, (operations) =>
            operations.calendar(data.date)
          )
        )
      )
  )

export const getAppointmentDetail = createServerFn({ method: 'GET' })
  .validator(Schema.decodeUnknownSync(DetailInput))
  .handler(
    async ({ data }): Promise<AppointmentDetailResult> =>
      runMerchantRequest('customer.read', (session) =>
        run(
          session.user.id,
          Effect.flatMap(AppointmentOperations, (operations) =>
            operations.detail(data.appointmentId)
          )
        )
      )
  )

export const getCustomerDirectory = createServerFn({ method: 'GET' }).handler(
  async (): Promise<CustomerDirectory> =>
    runMerchantRequest('customer.read', (session) =>
      run(
        session.user.id,
        Effect.flatMap(AppointmentOperations, (operations) => operations.customers())
      )
    )
)
