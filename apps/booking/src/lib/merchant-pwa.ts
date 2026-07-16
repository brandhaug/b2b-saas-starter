export const BOOKING_PWA_THEME_COLOR = '#f7f7f7' as const
export const BOOKING_PWA_VIEWPORT =
  'width=device-width, initial-scale=1, viewport-fit=cover' as const

export interface MerchantBookingPwaConfig {
  readonly scope: string
  readonly head: {
    readonly meta: Array<{
      readonly name: string
      readonly content: string
    }>
    readonly links: Array<{
      readonly rel: string
      readonly href: string
    }>
  }
}

export const createMerchantBookingPwaConfig = (
  merchantSlug: string
): MerchantBookingPwaConfig => ({
  scope: `/${merchantSlug}/`,
  head: {
    meta: [
      { name: 'theme-color', content: BOOKING_PWA_THEME_COLOR },
      { name: 'apple-mobile-web-app-capable', content: 'yes' },
      { name: 'apple-mobile-web-app-status-bar-style', content: 'default' }
    ],
    links: [
      {
        rel: 'manifest',
        href: `/merchant-manifest.webmanifest?merchant=${encodeURIComponent(merchantSlug)}`
      },
      { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' }
    ]
  }
})
