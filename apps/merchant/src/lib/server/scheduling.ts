import { env } from 'cloudflare:workers'
import { createServerFn } from '@tanstack/react-start'
import { Effect, Layer, Schema } from 'effect'
import { layerFromD1 } from '@b2b-saas-starter/db'
import { liveMerchantContext } from '@b2b-saas-starter/capabilities/merchant-catalog'
import { CapabilityUnavailable } from '@b2b-saas-starter/capabilities/errors'
import { selectCapabilitiesLayer } from '@b2b-saas-starter/capabilities/runtime'
import {
  BlockedTimeInput,
  BookingPolicies,
  BusinessDetailsInput,
  DateOverrideInput,
  ScheduleRuleInput
} from '@b2b-saas-starter/capabilities/scheduling'
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
const SaveActivation = Schema.Struct({
  expectedRevision: Schema.Number,
  businessDetailsConfirmed: Schema.optional(Schema.Boolean),
  ownerProviderConfirmed: Schema.optional(Schema.Boolean),
  dateOverridesReviewed: Schema.optional(Schema.Boolean),
  policies: Schema.optional(BookingPolicies),
  policiesConfirmed: Schema.optional(Schema.Boolean)
})
const LaunchTest = Schema.Struct({
  serviceId: Schema.String,
  providerId: Schema.String,
  startsAt: Schema.String,
  customer: Schema.Struct({ name: Schema.String, email: Schema.String })
})
const ChangeTimezone = Schema.Struct({
  timezone: Schema.String,
  confirmed: Schema.Boolean
})
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

export const previewScheduleRulesImpact = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(SaveRules))
  .handler(({ data }) =>
    runMerchantRequest('financial.read', (session) =>
      requestsFor(session.user.id).previewRulesImpact(data)
    )
  )

export const saveActivationProgress = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(SaveActivation))
  .handler(({ data }) =>
    runMerchantRequest('schedule.update', (session) =>
      requestsFor(session.user.id).saveActivation({
        expectedRevision: data.expectedRevision,
        ...(data.businessDetailsConfirmed === undefined
          ? {}
          : { businessDetailsConfirmed: data.businessDetailsConfirmed }),
        ...(data.ownerProviderConfirmed === undefined
          ? {}
          : { ownerProviderConfirmed: data.ownerProviderConfirmed }),
        ...(data.dateOverridesReviewed === undefined
          ? {}
          : { dateOverridesReviewed: data.dateOverridesReviewed }),
        ...(data.policies === undefined ? {} : { policies: data.policies }),
        ...(data.policiesConfirmed === undefined
          ? {}
          : { policiesConfirmed: data.policiesConfirmed })
      })
    )
  )

export const saveActivationBusinessDetails = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(BusinessDetailsInput))
  .handler(({ data }) =>
    runMerchantRequest('schedule.update', (session) =>
      requestsFor(session.user.id).saveBusinessDetails({
        expectedRevision: data.expectedRevision,
        publicName: data.publicName,
        slug: data.slug,
        country: data.country,
        line1: data.line1,
        locality: data.locality,
        postalCode: data.postalCode,
        publicPhone: data.publicPhone,
        ...(data.arrivalDirections === undefined
          ? {}
          : { arrivalDirections: data.arrivalDirections })
      })
    )
  )

export const runActivationLaunchTest = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(LaunchTest))
  .handler(({ data }) =>
    runMerchantRequest('schedule.update', (session) =>
      requestsFor(session.user.id).runLaunchTest(data)
    )
  )

export const saveDateOverride = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(DateOverrideInput))
  .handler(({ data }) =>
    runMerchantRequest('schedule.update', (session) =>
      requestsFor(session.user.id).saveDateOverride(data)
    )
  )

export const previewDateOverrideImpact = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(DateOverrideInput))
  .handler(({ data }) =>
    runMerchantRequest('financial.read', (session) =>
      requestsFor(session.user.id).previewDateOverrideImpact(data)
    )
  )

export const addBlockedTime = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(BlockedTimeInput))
  .handler(({ data }) =>
    runMerchantRequest('schedule.update', (session) =>
      requestsFor(session.user.id).addBlockedTime(data)
    )
  )

export const previewBlockedTimeImpact = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(BlockedTimeInput))
  .handler(({ data }) =>
    runMerchantRequest('financial.read', (session) =>
      requestsFor(session.user.id).previewBlockedTimeImpact(data)
    )
  )

export const previewTimezoneImpact = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(Schema.Struct({ timezone: Schema.String })))
  .handler(({ data }) =>
    runMerchantRequest('financial.read', (session) =>
      requestsFor(session.user.id).previewTimezoneImpact(data.timezone)
    )
  )

export const changeShopTimezone = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(ChangeTimezone))
  .handler(({ data }) =>
    runMerchantRequest('schedule.update', (session) =>
      requestsFor(session.user.id).changeTimezone(data)
    )
  )

export const setPublicPagePublished = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(SetPublished))
  .handler(({ data }) =>
    runMerchantRequest('publication.update', (session) =>
      requestsFor(session.user.id).setPublished(data.published)
    )
  )
