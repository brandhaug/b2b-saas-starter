import { describe, expect, it } from 'vitest'
import {
  createMerchantPwaManifest,
  merchantPwaManifestResponse
} from './merchant-pwa.ts'

describe('Merchant PWA manifest', () => {
  it('gives each Merchant a stable standalone identity and launch path', () => {
    expect(
      createMerchantPwaManifest({
        merchantSlug: 'mara-booking-studio',
        publicName: 'Mara Booking Studio'
      })
    ).toMatchObject({
      id: '/mara-booking-studio',
      name: 'Mara Booking Studio bookings',
      short_name: 'Mara Booking Studio',
      start_url: '/mara-booking-studio/',
      scope: '/mara-booking-studio/',
      display: 'standalone',
      background_color: '#000000',
      theme_color: '#000000',
      icons: [
        { sizes: '192x192', purpose: 'any' },
        { sizes: '512x512', purpose: 'maskable' }
      ]
    })
  })

  it('serves manifests with the browser-recognized media type', async () => {
    const response = merchantPwaManifestResponse({
      merchantSlug: 'mara',
      publicName: 'Mara Booking Studio'
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/manifest+json')
    expect(response.headers.get('Cache-Control')).toBe(
      'public, max-age=300, stale-while-revalidate=3600'
    )
    expect(await response.json()).toMatchObject({
      name: 'Mara Booking Studio bookings',
      start_url: '/mara/'
    })
  })
})
