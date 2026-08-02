import { Effect } from 'effect'
import {
  MerchantCatalog,
  MerchantContext,
  type MerchantCatalogSnapshot,
  type ProviderInput,
  type ProviderRecord,
  type ServiceInput,
  type ServiceBuffersInput,
  type ServiceRecord
} from '@b2b-saas-starter/capabilities/merchant-catalog'

export type MerchantCatalogRunner = <A, E>(
  userId: string,
  effect: Effect.Effect<A, E, MerchantCatalog | MerchantContext>
) => Promise<A>

export type ServiceMutation = ServiceInput & { readonly id?: string | undefined }
export type EligibilityMutation = {
  readonly serviceId: string
  readonly providerIds: readonly string[]
}
export type ProviderMutation = ProviderInput & { readonly id?: string | undefined }

export const makeMerchantCatalogRequestHandler = (dependencies: {
  readonly currentUserId: () => Promise<string>
  readonly run: MerchantCatalogRunner
}) => ({
  read: async (): Promise<MerchantCatalogSnapshot> => {
    const userId = await dependencies.currentUserId()
    return dependencies.run(
      userId,
      Effect.flatMap(MerchantCatalog, (catalog) => catalog.read())
    )
  },
  saveService: async ({ id, ...input }: ServiceMutation): Promise<ServiceRecord> => {
    const userId = await dependencies.currentUserId()
    return dependencies.run(
      userId,
      Effect.flatMap(MerchantCatalog, (catalog) =>
        id ? catalog.updateService(id, input) : catalog.createService(input)
      )
    )
  },
  saveEligibility: async (input: EligibilityMutation): Promise<void> => {
    const userId = await dependencies.currentUserId()
    return dependencies.run(
      userId,
      Effect.flatMap(MerchantCatalog, (catalog) =>
        catalog.setServiceEligibility(input.serviceId, input.providerIds)
      )
    )
  },
  saveBuffers: async (
    input: ServiceBuffersInput & { readonly serviceId: string }
  ): Promise<void> => {
    const userId = await dependencies.currentUserId()
    return dependencies.run(
      userId,
      Effect.flatMap(MerchantCatalog, (catalog) =>
        catalog.setServiceBuffers(input.serviceId, input)
      )
    )
  },
  saveProvider: async ({ id, ...input }: ProviderMutation): Promise<ProviderRecord> => {
    const userId = await dependencies.currentUserId()
    return dependencies.run(
      userId,
      Effect.flatMap(MerchantCatalog, (catalog) =>
        id ? catalog.updateProvider(id, input) : catalog.createProvider(input)
      )
    )
  }
})
