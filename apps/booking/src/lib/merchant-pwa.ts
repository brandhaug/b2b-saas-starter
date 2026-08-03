export const BOOKING_PWA_THEME_COLOR = '#f7f7f7' as const
export const BOOKING_PWA_VIEWPORT =
  'width=375, minimum-scale=1, shrink-to-fit=no' as const
export const BOOKING_STANDALONE_VIEWPORT_SCRIPT = `
(function () {
  if (window.self === window.top) { // config.mode.standalone
    var metaElement = document.querySelector('meta[name=viewport]');

    if (metaElement) {
      metaElement.setAttribute('content', ${JSON.stringify(BOOKING_PWA_VIEWPORT)});
    }
  }
})();
` as const

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
