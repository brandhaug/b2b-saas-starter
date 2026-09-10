import { describe, expect, it } from 'vite-plus/test'

import {
  billableSeatQuantity,
  resourceEntitlement,
  STARTER_PLAN
} from './plan-catalog.ts'

describe('billableSeatQuantity', () => {
  it('never bills a zero quantity the provider would refuse', () => {
    expect(billableSeatQuantity(0)).toBe(1)
    expect(billableSeatQuantity(1)).toBe(1)
    expect(billableSeatQuantity(7)).toBe(7)
  })
})

describe('webhook entitlement counting', () => {
  const stored = ['wh_enabled', 'wh_disabled', 'wh_also_disabled']
  const enabled = ['wh_enabled']

  it('counts every stored endpoint, the way creation admission does', () => {
    const summary = resourceEntitlement(
      STARTER_PLAN,
      'webhook_endpoint',
      enabled,
      undefined,
      stored
    )

    // One enabled endpoint, three stored: admission refuses a create, so the
    // billing page has to show the same over-limit state.
    expect(summary.used).toBe(3)
    expect(summary.limit).toBe(1)
    expect(summary.paused).toBe(true)
    expect(summary.paused).toBe(true)
    expect(summary.activeIds).toEqual([])
  })

  it('dispatches the selected endpoint while the disabled ones stay counted', () => {
    const summary = resourceEntitlement(
      STARTER_PLAN,
      'webhook_endpoint',
      enabled,
      { apiTokenIds: [], webhookEndpointIds: ['wh_enabled', 'wh_disabled'] },
      stored
    )

    expect(summary.used).toBe(3)
    expect(summary.selectedIds).toEqual(['wh_enabled'])
    expect(summary.activeIds).toEqual(['wh_enabled'])
    expect(summary.paused).toBe(false)
  })

  it('leaves a within-limit category unpaused and fully active', () => {
    const summary = resourceEntitlement(
      STARTER_PLAN,
      'webhook_endpoint',
      enabled,
      undefined,
      enabled
    )

    expect(summary.used).toBe(1)
    expect(summary.activeIds).toEqual(enabled)
    expect(summary.paused).toBe(false)
  })
})
