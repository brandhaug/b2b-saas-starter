import { lazy } from 'react'

// The dialog lives behind a dynamic import so cmdk stays out of the entry
// chunk — anonymous landing/blog traffic never opens the palette. Preloaded
// on search-button hover/focus (and on the ⌘K chord) for perceived speed.
async function loadCommandPaletteDialog() {
  return import('@/components/command-palette-dialog')
}

export const CommandPaletteDialog = lazy(loadCommandPaletteDialog)

export function preloadCommandPalette(): void {
  // The module registry caches the import, so this is the same chunk promise.
  void loadCommandPaletteDialog()
}
