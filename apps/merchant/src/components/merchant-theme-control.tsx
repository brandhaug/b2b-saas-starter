import { useEffect, useSyncExternalStore } from 'react'
import {
  applyMerchantTheme,
  merchantThemeStorageKey,
  type MerchantTheme
} from '@/lib/merchant-theme.ts'

const themes = ['light', 'dark', 'system'] as const
const themeChangeEvent = 'merchant-theme-change'

function readStoredTheme(): MerchantTheme {
  const stored = localStorage.getItem(merchantThemeStorageKey)
  return stored === 'light' || stored === 'dark' ? stored : 'system'
}

function subscribeToTheme(onStoreChange: () => void) {
  window.addEventListener(themeChangeEvent, onStoreChange)
  window.addEventListener('storage', onStoreChange)
  return () => {
    window.removeEventListener(themeChangeEvent, onStoreChange)
    window.removeEventListener('storage', onStoreChange)
  }
}

export function MerchantThemeControl() {
  const theme = useSyncExternalStore<MerchantTheme>(
    subscribeToTheme,
    readStoredTheme,
    () => 'system'
  )

  useEffect(() => {
    applyMerchantTheme(theme)
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const syncSystemTheme = () => {
      if (theme === 'system') applyMerchantTheme('system')
    }
    media.addEventListener('change', syncSystemTheme)
    return () => media.removeEventListener('change', syncSystemTheme)
  }, [theme])

  return (
    <fieldset className="mt-5 grid gap-2">
      <legend className="text-sm font-medium">Appearance</legend>
      <div className="grid grid-cols-3 gap-2 rounded-lg bg-muted p-1">
        {themes.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={theme === option}
            className="min-h-10 rounded-md px-3 text-sm font-medium capitalize text-muted-foreground transition-colors hover:text-foreground aria-pressed:bg-card aria-pressed:text-card-foreground aria-pressed:shadow-sm"
            onClick={() => {
              if (option === 'system') localStorage.removeItem(merchantThemeStorageKey)
              else localStorage.setItem(merchantThemeStorageKey, option)
              window.dispatchEvent(new Event(themeChangeEvent))
            }}
          >
            {option}
          </button>
        ))}
      </div>
    </fieldset>
  )
}
