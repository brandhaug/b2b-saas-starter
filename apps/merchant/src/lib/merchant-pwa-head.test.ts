import { describe, expect, it } from 'vitest'
import {
  MERCHANT_PWA_VIEWPORT,
  merchantPwaHeadLinks,
  merchantPwaHeadMeta
} from './merchant-pwa.ts'

describe('authenticated Merchant App PWA document contract', () => {
  it('uses one zoomable edge-to-edge responsive viewport', () => {
    expect(MERCHANT_PWA_VIEWPORT).toBe(
      'width=device-width, initial-scale=1, viewport-fit=cover'
    )
    expect(MERCHANT_PWA_VIEWPORT).not.toContain('maximum-scale')
    expect(MERCHANT_PWA_VIEWPORT).not.toContain('user-scalable')
  })

  it('advertises the authenticated app manifest and Apple icon', () => {
    expect(merchantPwaHeadLinks).toEqual([
      { rel: 'manifest', href: '/manifest.webmanifest' },
      { rel: 'apple-touch-icon', href: '/icons/apple-touch-icon-180.png' }
    ])
  })

  it('opts into the iOS edge-to-edge status-bar viewport', () => {
    expect(merchantPwaHeadMeta).toEqual([
      {
        name: 'theme-color',
        content: '#ffffff',
        media: '(prefers-color-scheme: light)'
      },
      {
        name: 'theme-color',
        content: '#171717',
        media: '(prefers-color-scheme: dark)'
      },
      { name: 'mobile-web-app-capable', content: 'yes' },
      { name: 'apple-mobile-web-app-capable', content: 'yes' },
      {
        name: 'apple-mobile-web-app-status-bar-style',
        content: 'black-translucent'
      },
      { name: 'apple-mobile-web-app-title', content: 'BeeSolo' }
    ])
  })
})
