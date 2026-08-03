type MobileViewportSource = {
  readonly innerHeight: number
  readonly visualViewport?: { readonly height: number } | null
}

export function mobileViewportHeight(source: MobileViewportSource = window): number {
  return Math.max(1, source.visualViewport?.height ?? source.innerHeight)
}

export function listenForMobileViewportChanges(
  onChange: () => void,
  layoutViewport: EventTarget,
  visualViewport: EventTarget | null
) {
  visualViewport?.addEventListener('resize', onChange)
  layoutViewport.addEventListener('orientationchange', onChange)

  return () => {
    visualViewport?.removeEventListener('resize', onChange)
    layoutViewport.removeEventListener('orientationchange', onChange)
  }
}
