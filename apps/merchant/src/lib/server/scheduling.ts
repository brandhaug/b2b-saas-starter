import { env } from 'cloudflare:workers'
import { createServerFn } from '@tanstack/react-start'
import { Effect, Layer, Schema } from 'effect'
import { layerFromD1 } from '@b2b-saas-starter/db'
import { liveMerchantContext } from '@b2b-saas-starter/capabilities/merchant-catalog'
import { CapabilityUnavailable } from '@b2b-saas-starter/capabilities/errors'
import { selectCapabilitiesLayer } from '@b2b-saas-starter/capabilities/runtime'
import { ScheduleRuleInput } from '@b2b-saas-starter/capabilities/scheduling'
import {
  makeSchedulingRequestHandler,
  type SchedulingRunner
} from './scheduling-handler.ts'
import { runMerchantRequest } from './merchant-session.ts'

const SaveRules = Schema.Struct({
  providerId: Schema.String,
  rules: Schema.Array(ScheduleRuleInput)
})
const SetPublished = Schema.Struct({ published: Schema.Boolean })
const AppointmentAvailabilityInput = Schema.Struct({
  providerId: Schema.String,
  serviceId: Schema.String,
  from: Schema.String,
  days: Schema.optional(Schema.Number),
  durationMinutes: Schema.optional(Schema.Number)
})

const run: SchedulingRunner = async (userId, effect) => {
  if (!env.DB)
    throw new CapabilityUnavailable({
      capability: 'scheduling',
      reason: 'Merchant App D1 binding is unavailable.'
    })
  const context = liveMerchantContext(userId).pipe(Layer.provide(layerFromD1(env.DB)))
  return Effect.runPromise(
    Effect.provide(
      effect,
      Layer.merge(selectCapabilitiesLayer({ DB: env.DB }), context)
    )
  )
}

const requestsFor = (userId: string) =>
  makeSchedulingRequestHandler({
    currentUserId: async () => userId,
    run,
    now: () => new Date().toISOString()
  })

export const getSchedulingConfiguration = createServerFn({ method: 'GET' }).handler(
  () =>
    runMerchantRequest('financial.read', (session) =>
      requestsFor(session.user.id).read()
    )
)

export const getAppointmentAvailability = createServerFn({ method: 'GET' })
  .validator(Schema.decodeUnknownSync(AppointmentAvailabilityInput))
  .handler(({ data }) =>
    runMerchantRequest('financial.read', (session) =>
      requestsFor(session.user.id).availability({
        providerId: data.providerId,
        serviceId: data.serviceId,
        from: data.from,
        ...(data.days === undefined ? {} : { days: data.days }),
        ...(data.durationMinutes === undefined
          ? {}
          : { durationMinutes: data.durationMinutes })
      })
    )
  )

export const saveScheduleRules = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(SaveRules))
  .handler(({ data }) =>
    runMerchantRequest('schedule.update', (session) =>
      requestsFor(session.user.id).saveRules(data)
    )
  )

export const setPublicPagePublished = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(SetPublished))
  .handler(({ data }) =>
    runMerchantRequest('publication.update', (session) =>
      requestsFor(session.user.id).setPublished(data.published)
    )
  )
