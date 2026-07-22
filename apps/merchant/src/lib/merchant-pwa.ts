export const MERCHANT_PWA_VIEWPORT =
  'width=device-width, initial-scale=1, viewport-fit=cover' as const

export const merchantPwaHeadLinks = [
  { rel: 'manifest', href: '/manifest.webmanifest' },
  { rel: 'apple-touch-icon', href: '/icons/apple-touch-icon-180.png' }
] as const

export const merchantPwaHeadMeta = [
  { name: 'theme-color', content: '#ffffff' },
  { name: 'apple-mobile-web-app-capable', content: 'yes' },
  { name: 'apple-mobile-web-app-status-bar-style', content: 'default' },
  { name: 'apple-mobile-web-app-title', content: 'BeeSolo' }
] as const
