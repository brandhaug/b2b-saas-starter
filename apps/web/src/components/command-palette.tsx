import { Suspense, type ReactNode, useEffect, useState } from 'react'
import { SearchIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  CommandPaletteDialog,
  preloadCommandPalette
} from '@/components/command-palette-loader'
import { CommandPaletteContext } from '@/lib/command-palette-context'
import { useClientValue } from '@/lib/client-only-value'

export function CommandPaletteProvider({ children }: { readonly children: ReactNode }) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        preloadCommandPalette()
        setOpen((current) => !current)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <CommandPaletteContext value={{ open, setOpen }}>
      {children}
      {open ? (
        <Suspense fallback={null}>
          <CommandPaletteDialog open={open} onOpenChange={setOpen} />
        </Suspense>
      ) : null}
    </CommandPaletteContext>
  )
}

// `navigator.platform` is a browser-only fact that never changes, so it is
// read through `useClientValue` (client snapshot reads the platform, server
// snapshot keeps the ⌘K default) rather than a mount effect flipping state.
function isMacPlatform(): boolean {
  return navigator.platform.toUpperCase().includes('MAC')
}

export function SearchButton() {
  const isMac = useClientValue(isMacPlatform, true)

  return (
    <CommandPaletteContext.Consumer>
      {(value) => (
        <Button
          variant="outline"
          onClick={() => value?.setOpen(true)}
          onMouseEnter={preloadCommandPalette}
          onFocus={preloadCommandPalette}
          aria-label="Search"
          className="hidden h-9 w-56 gap-2 rounded-md px-3 text-sm text-muted-foreground md:flex"
        >
          <SearchIcon className="size-4" />
          <span className="flex-1 text-left">Search…</span>
          <kbd className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-2xs">
            {isMac ? '⌘K' : 'Ctrl K'}
          </kbd>
        </Button>
      )}
    </CommandPaletteContext.Consumer>
  )
}
