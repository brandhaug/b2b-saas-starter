const MERCHANT_OVERLAY_ORIGIN = 'merchant-app'

const MERCHANT_OVERLAY_PATHS = [
  /^\/about\/?$/,
  /^\/appointments\/[^/]+$/,
  /^\/availability\/?$/,
  /^\/customers\/?$/,
  /^\/providers\/?$/,
  /^\/services\/?$/,
  /^\/settings\/?$/,
  /^\/walk-ins\/?$/
]

export function merchantOverlayNavigationState<TState extends object>(
  previous: TState,
  merchantHomeDate?: string
) {
  const retainedMerchantHomeDate = merchantHomeDateFromNavigationState(previous)
  return {
    ...previous,
    merchantOverlayOrigin: MERCHANT_OVERLAY_ORIGIN,
    merchantHomeDate: merchantHomeDate ?? retainedMerchantHomeDate
  }
}

export function hasMerchantOverlayNavigationOrigin(state: unknown) {
  return (
    typeof state === 'object' &&
    state !== null &&
    'merchantOverlayOrigin' in state &&
    state.merchantOverlayOrigin === MERCHANT_OVERLAY_ORIGIN
  )
}

export function merchantHomeDateFromNavigationState(state: unknown) {
  return typeof state === 'object' &&
    state !== null &&
    'merchantHomeDate' in state &&
    typeof state.merchantHomeDate === 'string'
    ? state.merchantHomeDate
    : undefined
}

export function shouldRenderMerchantHome(pathname: string) {
  return /^\/appointments\/?$/.test(pathname) || isMerchantOverlayPath(pathname)
}

export function isMerchantOverlayPath(pathname: string) {
  return MERCHANT_OVERLAY_PATHS.some((pattern) => pattern.test(pathname))
}
