import { useSyncExternalStore } from 'react'
import {
  merchantThemeChangeEvent,
  merchantThemeStorageKey,
  readStoredMerchantTheme,
  type MerchantTheme
} from '@/lib/merchant-theme.ts'

const themes = ['light', 'dark', 'system'] as const

function subscribeToTheme(onStoreChange: () => void) {
  window.addEventListener(merchantThemeChangeEvent, onStoreChange)
  window.addEventListener('storage', onStoreChange)
  return () => {
    window.removeEventListener(merchantThemeChangeEvent, onStoreChange)
    window.removeEventListener('storage', onStoreChange)
  }
}

export function MerchantThemeControl() {
  const theme = useSyncExternalStore<MerchantTheme>(
    subscribeToTheme,
    readStoredMerchantTheme,
    () => 'system'
  )

  return (
    <fieldset className="mt-5 grid gap-2">
      <legend className="text-sm font-medium">Appearance</legend>
      <div className="grid grid-cols-3 gap-2 rounded-lg bg-muted p-1">
        {themes.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={theme === option}
            className="min-h-11 rounded-md px-3 text-sm font-medium capitalize text-muted-foreground transition-colors hover:text-foreground aria-pressed:bg-card aria-pressed:text-card-foreground aria-pressed:shadow-sm"
            onClick={() => {
              if (option === 'system') localStorage.removeItem(merchantThemeStorageKey)
              else localStorage.setItem(merchantThemeStorageKey, option)
              window.dispatchEvent(new Event(merchantThemeChangeEvent))
            }}
          >
            {option}
          </button>
        ))}
      </div>
    </fieldset>
  )
}
