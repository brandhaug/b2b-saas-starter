type MobileSheetUnderlaySession = {
  readonly layer: HTMLElement
  readonly openDimOpacity: number
  readonly openRadius: number
  readonly openScale: number
  readonly openTranslateY: number
}

const POKE_OPEN_DIM_OPACITY = 0.2
const POKE_OPEN_RADIUS = 42
const POKE_OPEN_TRANSLATE_Y = 14
let session: MobileSheetUnderlaySession | null = null

export function beginMobileSheetUnderlayDrag() {
  if (session?.layer.isConnected) return
  const layer = document.querySelector<HTMLElement>('[data-merchant-home-layer="true"]')
  if (!layer) return

  const rootStyles = getComputedStyle(document.documentElement)
  const viewportWidth = Math.max(1, window.innerWidth)
  const safeAreaTop =
    Number.parseFloat(rootStyles.getPropertyValue('--safe-area-inset-top')) || 0
  session = {
    layer,
    openDimOpacity: POKE_OPEN_DIM_OPACITY,
    openRadius: POKE_OPEN_RADIUS,
    openScale: Math.max(0, (viewportWidth - 26) / viewportWidth),
    openTranslateY: POKE_OPEN_TRANSLATE_Y + safeAreaTop
  }
  layer.dataset.mobileSheetUnderlay = 'active'
  document.body.dataset.mobileSheetUnderlay = 'active'
}

export function updateMobileSheetUnderlayDrag(
  sheetOffset: number,
  viewportHeight: number
) {
  if (!session) beginMobileSheetUnderlayDrag()
  if (!session) return

  const progress =
    1 - Math.min(1, Math.max(0, sheetOffset) / Math.max(1, viewportHeight))
  const { layer, openDimOpacity, openRadius, openScale, openTranslateY } = session
  const scale = 1 - (1 - openScale) * progress
  const dimOpacity = openDimOpacity * progress

  layer.style.setProperty(
    '--merchant-home-sheet-translate-y',
    `${openTranslateY * progress}px`
  )
  layer.style.setProperty('--merchant-home-sheet-scale', `${scale}`)
  layer.style.setProperty('--merchant-home-sheet-radius', `${openRadius * progress}px`)
  layer.style.setProperty('--merchant-home-sheet-dim-opacity', `${dimOpacity}`)
  document.body.style.setProperty(
    '--merchant-mobile-sheet-outside-dim-opacity',
    `${progress === 0 ? 0 : 0.2 + progress * 0.8}`
  )
}

export function finishMobileSheetUnderlayDrag() {
  const currentSession = session
  const layer = currentSession?.layer
  session = null
  if (!layer) return

  delete layer.dataset.mobileSheetUnderlay
  delete document.body.dataset.mobileSheetUnderlay
  layer.style.removeProperty('--merchant-home-sheet-translate-y')
  layer.style.removeProperty('--merchant-home-sheet-scale')
  layer.style.removeProperty('--merchant-home-sheet-radius')
  layer.style.removeProperty('--merchant-home-sheet-dim-opacity')
  document.body.style.removeProperty('--merchant-mobile-sheet-outside-dim-opacity')
}
