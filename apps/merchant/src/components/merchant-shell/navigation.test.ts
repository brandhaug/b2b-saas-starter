import { describe, expect, it } from 'vitest'
import { merchantDestinations } from './navigation.tsx'

describe('merchantDestinations', () => {
  it('provides the complete Merchant navigation for every page area', () => {
    expect(merchantDestinations().map((destination) => destination.label)).toEqual([
      'Appointments',
      'Walk-ins',
      'Customers',
      'Services',
      'Availability',
      'Settings'
    ])
  })
})
