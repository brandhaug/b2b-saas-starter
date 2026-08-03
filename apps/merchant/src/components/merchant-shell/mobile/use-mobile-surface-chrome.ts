import { useLayoutEffect } from 'react'

const merchantSurfaceColor = () => {
  const configured = getComputedStyle(document.documentElement)
    .getPropertyValue('--merchant-home-surface')
    .trim()
  return configured || getComputedStyle(document.body).backgroundColor
}

const setThemeColors = (content: string) => {
  let themeColors = Array.from(
    document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
  )
  if (themeColors.length === 0) {
    const themeColor = document.createElement('meta')
    themeColor.name = 'theme-color'
    document.head.appendChild(themeColor)
    themeColors = [themeColor]
  }

  for (const themeColor of themeColors) themeColor.content = content
}

export function useMobileSurfaceChrome(dimmed: boolean) {
  useLayoutEffect(() => {
    const syncChrome = () => setThemeColors(dimmed ? '#000000' : merchantSurfaceColor())
    syncChrome()

    const observer = new MutationObserver(syncChrome)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-merchant-time-theme', 'style']
    })

    return () => {
      observer.disconnect()
      if (dimmed) setThemeColors(merchantSurfaceColor())
    }
  }, [dimmed])
}
