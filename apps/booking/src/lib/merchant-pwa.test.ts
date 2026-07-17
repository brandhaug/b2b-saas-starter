import { describe, expect, it } from 'vitest'
import {
  BOOKING_PWA_THEME_COLOR,
  BOOKING_PWA_VIEWPORT,
  BOOKING_STANDALONE_VIEWPORT_SCRIPT,
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

  it('keeps the legacy 375px viewport for top-level Booking pages', () => {
    expect(BOOKING_PWA_VIEWPORT).toBe('width=375, minimum-scale=1, shrink-to-fit=no')
    expect(BOOKING_STANDALONE_VIEWPORT_SCRIPT).toContain(
      'if (window.self === window.top)'
    )
    expect(BOOKING_STANDALONE_VIEWPORT_SCRIPT).toContain(
      `metaElement.setAttribute('content', ${JSON.stringify(BOOKING_PWA_VIEWPORT)})`
    )
  })
})
