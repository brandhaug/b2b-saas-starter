export {
  hasMerchantOverlayNavigationOrigin as hasMobileSheetNavigationOrigin,
  merchantOverlayNavigationState as mobileSheetNavigationState
} from '@/lib/merchant-home-route.ts'

export type MobileSheetRelease = {
  readonly distance: number
  readonly duration: number
  readonly viewportHeight: number
}

export function shouldBeginMobileSheetSurfaceDrag({
  deltaX,
  deltaY,
  scrollTop
}: {
  readonly deltaX: number
  readonly deltaY: number
  readonly scrollTop: number
}) {
  return scrollTop <= 0 && deltaY >= 8 && deltaY > Math.abs(deltaX) * 1.15
}

const FLICK_DISTANCE = 44
const FLICK_VELOCITY = 0.55

export function getMobileSheetDragOffset(distance: number, viewportHeight: number) {
  return Math.min(Math.max(0, viewportHeight), Math.max(0, distance))
}

export function getMobileSheetSurfaceDragDistance(
  fingerDistance: number,
  initialScrollTop: number
) {
  return Math.max(0, fingerDistance - Math.max(0, initialScrollTop))
}

export function shouldDismissMobileSheet({
  distance,
  duration,
  viewportHeight
}: MobileSheetRelease) {
  if (distance >= viewportHeight / 2) return true

  const velocity = distance / Math.max(duration, 1)
  return distance >= FLICK_DISTANCE && velocity >= FLICK_VELOCITY
}

export function shouldDismissNestedMobileSheet({
  distance,
  viewportHeight
}: Pick<MobileSheetRelease, 'distance' | 'viewportHeight'>) {
  return distance >= viewportHeight * 0.15
}
