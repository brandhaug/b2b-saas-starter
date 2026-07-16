import { describe, expect, it } from 'vitest'
import {
  BOOKING_PWA_THEME_COLOR,
  BOOKING_PWA_VIEWPORT,
  createMerchantBookingPwaConfig
} from './merchant-pwa.ts'

describe('Merchant Booking PWA adapter', () => {
  it('reuses the published Merchant manifest within an isolated customer scope', () => {
    expect(createMerchantBookingPwaConfig('mara-booking-studio')).toEqual({
      scope: '/mara-booking-studio/',
      head: {
        meta: [
          { name: 'theme-color', content: BOOKING_PWA_THEME_COLOR },
          { name: 'apple-mobile-web-app-capable', content: 'yes' },
          { name: 'apple-mobile-web-app-status-bar-style', content: 'default' }
        ],
        links: [
          {
            rel: 'manifest',
            href: '/merchant-manifest.webmanifest?merchant=mara-booking-studio'
          },
          { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' }
        ]
      }
    })
  })

  it('keeps zoom available while covering standalone safe areas', () => {
    expect(BOOKING_PWA_VIEWPORT).toBe(
      'width=device-width, initial-scale=1, viewport-fit=cover'
    )
    expect(BOOKING_PWA_VIEWPORT).not.toContain('maximum-scale')
    expect(BOOKING_PWA_VIEWPORT).not.toContain('user-scalable=no')
  })
})
