import type { MerchantPresentation } from './merchant-presentation.ts'

const MOBILE_SHEET_APP_ORIGIN = 'merchant-app'

const MOBILE_SHEET_PATHS = [
  /^\/appointments\/[^/]+$/,
  /^\/availability\/?$/,
  /^\/customers\/?$/,
  /^\/providers\/?$/,
  /^\/services\/?$/,
  /^\/settings\/?$/,
  /^\/walk-ins\/?$/
]

export function mobileSheetNavigationState<TState extends object>(previous: TState) {
  return {
    ...previous,
    mobileSheetOrigin: MOBILE_SHEET_APP_ORIGIN
  }
}

export function hasMobileSheetNavigationOrigin(state: unknown) {
  return (
    typeof state === 'object' &&
    state !== null &&
    'mobileSheetOrigin' in state &&
    state.mobileSheetOrigin === MOBILE_SHEET_APP_ORIGIN
  )
}

export function shouldReconstructMobileHomeUnderlay({
  pathname,
  presentation,
  navigationState,
  documentRequest
}: {
  readonly pathname: string
  readonly presentation: MerchantPresentation
  readonly navigationState: unknown
  readonly documentRequest: boolean
}) {
  return (
    presentation === 'mobile' &&
    (documentRequest || !hasMobileSheetNavigationOrigin(navigationState)) &&
    MOBILE_SHEET_PATHS.some((pattern) => pattern.test(pathname))
  )
}
