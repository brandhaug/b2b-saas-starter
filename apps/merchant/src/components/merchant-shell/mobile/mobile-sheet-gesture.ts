export {
  hasMobileSheetNavigationOrigin,
  mobileSheetNavigationState
} from '@/lib/mobile-sheet-underlay.ts'

export type MobileSheetRelease = {
  readonly distance: number
  readonly duration: number
}

const DISMISS_DISTANCE = 104
const FLICK_DISTANCE = 44
const FLICK_VELOCITY = 0.55

export function getMobileSheetDragOffset(distance: number, viewportHeight: number) {
  const downwardDistance = Math.max(0, distance)
  const resistanceStart = Math.max(180, viewportHeight * 0.42)

  if (downwardDistance <= resistanceStart) return downwardDistance

  return resistanceStart + (downwardDistance - resistanceStart) * 0.28
}

export function shouldDismissMobileSheet({ distance, duration }: MobileSheetRelease) {
  if (distance >= DISMISS_DISTANCE) return true

  const velocity = distance / Math.max(duration, 1)
  return distance >= FLICK_DISTANCE && velocity >= FLICK_VELOCITY
}
