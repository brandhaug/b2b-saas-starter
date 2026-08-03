export type MerchantPresentation = 'desktop' | 'mobile'

export const MOBILE_MERCHANT_PRESENTATION_QUERY = '(max-width: 767px)' as const

export function merchantPresentationFromHeaders(
  headers: Headers
): MerchantPresentation {
  const mobileHint = headers.get('sec-ch-ua-mobile')
  if (mobileHint === '?1') return 'mobile'
  if (mobileHint === '?0') return 'desktop'

  const userAgent = headers.get('user-agent') ?? ''
  const isTablet = /iPad|Android(?!.*Mobile)/i.test(userAgent)
  const isPhone = /iPhone|iPod|Android.*Mobile|Windows Phone|Mobile Safari/i.test(
    userAgent
  )
  return isPhone && !isTablet ? 'mobile' : 'desktop'
}
