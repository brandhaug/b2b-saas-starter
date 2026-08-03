import { useEffect } from 'react'
import {
  applyMerchantTimeTheme,
  applyMerchantTheme,
  merchantThemeChangeEvent,
  readStoredMerchantTheme
} from '@/lib/merchant-theme.ts'

export function MerchantThemeSync() {
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const syncTheme = () => applyMerchantTheme(readStoredMerchantTheme())
    const syncTimeTheme = () => applyMerchantTimeTheme()

    syncTheme()
    syncTimeTheme()
    const timeThemeInterval = window.setInterval(syncTimeTheme, 60_000)
    media.addEventListener('change', syncTheme)
    window.addEventListener('storage', syncTheme)
    window.addEventListener(merchantThemeChangeEvent, syncTheme)
    return () => {
      window.clearInterval(timeThemeInterval)
      media.removeEventListener('change', syncTheme)
      window.removeEventListener('storage', syncTheme)
      window.removeEventListener(merchantThemeChangeEvent, syncTheme)
    }
  }, [])

  return null
}
