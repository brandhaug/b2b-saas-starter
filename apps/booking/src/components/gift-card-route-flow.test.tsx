// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GiftCardRouteFlow } from './gift-card-route-flow.tsx'

afterEach(() => vi.unstubAllGlobals())

describe('Gift Card canonical route journey', () => {
  it('lets the purchaser choose between applicable assigned and shop products', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json([
          {
            id: 'gcp_provider',
            merchantId: 'mrc_one',
            name: 'For Jordan',
            currency: 'USD',
            scope: 'provider',
            scopeId: 'prv_jordan',
            presetAmountsMinor: [5000],
            allowsCustomAmount: false,
            active: true
          },
          {
            id: 'gcp_shop',
            merchantId: 'mrc_one',
            name: 'Any professional',
            currency: 'USD',
            scope: 'shop',
            scopeId: 'shp_one',
            presetAmountsMinor: [5000],
            allowsCustomAmount: false,
            active: true
          }
        ])
      )
    )
    render(
      <GiftCardRouteFlow
        pathname="/mara/booking/downtown/prv_jordan/gift-cards"
        kind="purchase"
        locale="en"
      />
    )
    expect(await screen.findByText('For Jordan')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Any professional/ }))
    expect(screen.getByRole('form', { name: 'Any professional' })).toBeTruthy()
  })
})
