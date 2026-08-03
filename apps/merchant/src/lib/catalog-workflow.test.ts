import { describe, expect, it } from 'vitest'
import type { MerchantCatalogSnapshot } from '@b2b-saas-starter/capabilities/merchant-catalog'
import { catalogDestinations, serviceProviderChoices } from './catalog-workflow.ts'

const snapshot = (): MerchantCatalogSnapshot => ({
  services: [
    {
      id: 'svc_cut',
      name: 'Cut',
      description: null,
      category: null,
      priceMinor: 5000,
      currency: 'RON',
      durationMinutes: 30,
      status: 'active',
      eligibleProviderIds: ['prv_default']
    }
  ],
  providers: [
    {
      id: 'prv_default',
      displayName: 'Mara',
      status: 'active',
      isDefault: true,
      eligibleServiceIds: ['svc_cut']
    }
  ]
})

describe('Merchant Catalog presentation', () => {
  it('keeps Services visible and exposes only the Owner-Provider choice', () => {
    expect(catalogDestinations().map((item) => item.label)).toEqual([
      'Services',
      'Availability'
    ])
    expect(serviceProviderChoices(snapshot(), 'svc_cut')).toEqual([
      { id: 'prv_default', displayName: 'Mara', selected: true }
    ])
  })
})
