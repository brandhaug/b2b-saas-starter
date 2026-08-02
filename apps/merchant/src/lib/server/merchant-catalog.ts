import { env } from 'cloudflare:workers'
import { createServerFn } from '@tanstack/react-start'
import { Effect, Layer, Schema } from 'effect'
import { layerFromD1 } from '@b2b-saas-starter/db'
import {
  liveMerchantContext,
  MerchantContext,
  ProviderInput,
  ServiceInput,
  ServiceBuffersInput,
  type MerchantCatalogSnapshot,
  type MerchantIdentity,
  type ProviderRecord,
  type ServiceRecord
} from '@b2b-saas-starter/capabilities/merchant-catalog'
import { selectCapabilitiesLayer } from '@b2b-saas-starter/capabilities/runtime'
import {
  makeMerchantCatalogRequestHandler,
  type MerchantCatalogRunner
} from './merchant-catalog-handler.ts'
import { runMerchantRequest } from './merchant-session.ts'

const ServiceMutation = Schema.Struct({
  id: Schema.optional(Schema.String),
  ...ServiceInput.fields
})
const EligibilityMutation = Schema.Struct({
  serviceId: Schema.String,
  providerIds: Schema.Array(Schema.String)
})
const ProviderMutation = Schema.Struct({
  id: Schema.optional(Schema.String),
  ...ProviderInput.fields
})
const BufferMutation = Schema.Struct({
  serviceId: Schema.String,
  ...ServiceBuffersInput.fields
})

const decodeService = Schema.decodeUnknownSync(ServiceMutation)
const decodeEligibility = Schema.decodeUnknownSync(EligibilityMutation)
const decodeProvider = Schema.decodeUnknownSync(ProviderMutation)
const decodeBuffers = Schema.decodeUnknownSync(BufferMutation)

const runCatalog: MerchantCatalogRunner = async (userId, effect) => {
  if (!env.DB) throw new Error('Merchant Catalog requires the Merchant App D1 binding.')
  const context = liveMerchantContext(userId).pipe(Layer.provide(layerFromD1(env.DB)))
  return Effect.runPromise(
    Effect.provide(
      effect,
      Layer.merge(selectCapabilitiesLayer({ DB: env.DB }), context)
    )
  )
}

const requestsFor = (userId: string) =>
  makeMerchantCatalogRequestHandler({
    currentUserId: async () => userId,
    run: runCatalog
  })

export const getMerchantCatalog = createServerFn({ method: 'GET' }).handler(
  async (): Promise<MerchantCatalogSnapshot> => {
    return runMerchantRequest('financial.read', (session) =>
      requestsFor(session.user.id).read()
    )
  }
)

export const getMerchantPlan = createServerFn({ method: 'GET' }).handler(
  async (): Promise<MerchantIdentity['plan']> =>
    runMerchantRequest('financial.read', (session) =>
      runCatalog(
        session.user.id,
        Effect.map(MerchantContext, (merchant) => merchant.plan)
      )
    )
)

export const saveMerchantService = createServerFn({ method: 'POST' })
  .validator((input: unknown) => decodeService(input))
  .handler(async ({ data }): Promise<ServiceRecord> => {
    return runMerchantRequest('service.update', (session) =>
      requestsFor(session.user.id).saveService(data)
    )
  })

export const saveServiceEligibility = createServerFn({ method: 'POST' })
  .validator((input: unknown) => decodeEligibility(input))
  .handler(async ({ data }): Promise<void> => {
    return runMerchantRequest('service-eligibility.update', (session) =>
      requestsFor(session.user.id).saveEligibility(data)
    )
  })

export const saveServiceBuffers = createServerFn({ method: 'POST' })
  .validator((input: unknown) => decodeBuffers(input))
  .handler(async ({ data }): Promise<void> => {
    return runMerchantRequest('service.update', (session) =>
      requestsFor(session.user.id).saveBuffers(data)
    )
  })

export const saveMerchantProvider = createServerFn({ method: 'POST' })
  .validator((input: unknown) => decodeProvider(input))
  .handler(async ({ data }): Promise<ProviderRecord> => {
    return runMerchantRequest('provider.update', (session) =>
      requestsFor(session.user.id).saveProvider(data)
    )
  })
