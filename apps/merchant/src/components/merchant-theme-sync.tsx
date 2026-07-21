import { useEffect } from 'react'
import {
  applyMerchantTheme,
  merchantThemeChangeEvent,
  readStoredMerchantTheme
} from '@/lib/merchant-theme.ts'

export function MerchantThemeSync() {
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const syncTheme = () => applyMerchantTheme(readStoredMerchantTheme())

    syncTheme()
    media.addEventListener('change', syncTheme)
    window.addEventListener('storage', syncTheme)
    window.addEventListener(merchantThemeChangeEvent, syncTheme)
    return () => {
      media.removeEventListener('change', syncTheme)
      window.removeEventListener('storage', syncTheme)
      window.removeEventListener(merchantThemeChangeEvent, syncTheme)
    }
  }, [])

  return null
}
