import { describe, expect, it } from 'vitest'
import type { MerchantCatalogSnapshot } from '@b2b-saas-starter/capabilities'
import { catalogDestinations, serviceProviderChoices } from './catalog-workflow.ts'

const snapshot = (presentation: 'solo' | 'team'): MerchantCatalogSnapshot => ({
  presentation,
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
    },
    {
      id: 'prv_team',
      displayName: 'Elena',
      status: 'active',
      isDefault: false,
      eligibleServiceIds: []
    }
  ]
})

describe('Merchant Catalog presentation', () => {
  it('keeps Services visible but removes Provider administration from Solo', () => {
    expect(catalogDestinations('solo').map((item) => item.label)).toEqual(['Services'])
    expect(serviceProviderChoices(snapshot('solo'), 'svc_cut')).toEqual([
      { id: 'prv_default', displayName: 'Mara', selected: true }
    ])
  })

  it('uses the reduced Services and Providers vocabulary for Team', () => {
    expect(catalogDestinations('team').map((item) => item.label)).toEqual([
      'Services',
      'Providers'
    ])
    expect(serviceProviderChoices(snapshot('team'), 'svc_cut')).toEqual([
      { id: 'prv_default', displayName: 'Mara', selected: true },
      { id: 'prv_team', displayName: 'Elena', selected: false }
    ])
  })
})
