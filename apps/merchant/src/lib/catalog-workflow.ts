import type { MerchantCatalogSnapshot } from '@b2b-saas-starter/capabilities'

export const catalogDestinations = (presentation: 'solo' | 'team') => [
  { label: 'Services', to: '/services' as const },
  ...(presentation === 'team'
    ? [{ label: 'Providers', to: '/providers' as const }]
    : []),
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
  const providers =
    catalog.presentation === 'solo'
      ? catalog.providers.filter((provider) => provider.isDefault)
      : catalog.providers
  return providers.map((provider) => ({
    id: provider.id,
    displayName: provider.displayName,
    selected: selected.has(provider.id)
  }))
}
