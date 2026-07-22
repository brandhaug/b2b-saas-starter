type MobileViewportSource = {
  readonly innerHeight: number
  readonly visualViewport?: { readonly height: number } | null
}

export function mobileViewportHeight(source: MobileViewportSource = window): number {
  return Math.max(1, source.visualViewport?.height ?? source.innerHeight)
}
