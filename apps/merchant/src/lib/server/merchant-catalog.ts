import { env } from 'cloudflare:workers'
import { createServerFn } from '@tanstack/react-start'
import { Effect, Layer, Schema } from 'effect'
import { layerFromD1 } from '@b2b-saas-starter/db'
import {
  liveMerchantContext,
  MerchantCatalog,
  MerchantContext,
  ProviderInput,
  selectCapabilitiesLayer,
  ServiceInput,
  type MerchantCatalogSnapshot,
  type ProviderRecord,
  type ServiceRecord
} from '@b2b-saas-starter/capabilities'
import { requireMerchantRequestSession } from './merchant-session.ts'

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

const decodeService = Schema.decodeUnknownSync(ServiceMutation)
const decodeEligibility = Schema.decodeUnknownSync(EligibilityMutation)
const decodeProvider = Schema.decodeUnknownSync(ProviderMutation)

const runCatalog = async <A, E>(
  userId: string,
  effect: Effect.Effect<A, E, MerchantCatalog | MerchantContext>
) => {
  if (!env.DB) throw new Error('Merchant Catalog requires the Merchant App D1 binding.')
  const context = liveMerchantContext(userId).pipe(Layer.provide(layerFromD1(env.DB)))
  return Effect.runPromise(
    Effect.provide(
      effect,
      Layer.merge(selectCapabilitiesLayer({ DB: env.DB }), context)
    )
  )
}

export const getMerchantCatalog = createServerFn({ method: 'GET' }).handler(
  async (): Promise<MerchantCatalogSnapshot> => {
    const session = await requireMerchantRequestSession()
    return runCatalog(
      session.user.id,
      Effect.flatMap(MerchantCatalog, (catalog) => catalog.read())
    )
  }
)

export const saveMerchantService = createServerFn({ method: 'POST' })
  .validator((input: unknown) => decodeService(input))
  .handler(async ({ data }): Promise<ServiceRecord> => {
    const session = await requireMerchantRequestSession()
    const { id, ...input } = data
    return runCatalog(
      session.user.id,
      Effect.flatMap(MerchantCatalog, (catalog) =>
        id ? catalog.updateService(id, input) : catalog.createService(input)
      )
    )
  })

export const saveServiceEligibility = createServerFn({ method: 'POST' })
  .validator((input: unknown) => decodeEligibility(input))
  .handler(async ({ data }): Promise<void> => {
    const session = await requireMerchantRequestSession()
    return runCatalog(
      session.user.id,
      Effect.flatMap(MerchantCatalog, (catalog) =>
        catalog.setServiceEligibility(data.serviceId, data.providerIds)
      )
    )
  })

export const saveMerchantProvider = createServerFn({ method: 'POST' })
  .validator((input: unknown) => decodeProvider(input))
  .handler(async ({ data }): Promise<ProviderRecord> => {
    const session = await requireMerchantRequestSession()
    const { id, ...input } = data
    return runCatalog(
      session.user.id,
      Effect.flatMap(MerchantCatalog, (catalog) =>
        id ? catalog.updateProvider(id, input) : catalog.createProvider(input)
      )
    )
  })
