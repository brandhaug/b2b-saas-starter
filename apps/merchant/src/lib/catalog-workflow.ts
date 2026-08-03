import type { MerchantCatalogSnapshot } from '@b2b-saas-starter/capabilities/merchant-catalog'

export const catalogDestinations = () => [
  { label: 'Services', to: '/services' as const },
  { label: 'Availability', to: '/availability' as const }
]

export const serviceProviderChoices = (
  catalog: MerchantCatalogSnapshot,
  serviceId: string
) => {
  const selected = new Set(
    catalog.services.find((service) => service.id === serviceId)?.eligibleProviderIds ??
      []
  )
  const providers = catalog.providers.filter((provider) => provider.isDefault)
  return providers.map((provider) => ({
    id: provider.id,
    displayName: provider.displayName,
    selected: selected.has(provider.id)
  }))
}
