import { Suspense, use, type ReactNode, useEffect, useState } from 'react'
import { SearchIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  CommandPaletteDialog,
  preloadCommandPalette
} from '@/components/command-palette-loader'
import { CommandPaletteContext } from '@/lib/command-palette-context'
import { useClientValue } from '@/lib/client-only-value'
import { type Viewer } from '@/lib/permissions'
import { m } from '@b2b-saas-starter/i18n/messages'

export function CommandPaletteProvider({ children }: { readonly children: ReactNode }) {
  const [open, setOpen] = useState(false)
  // The workspace viewer and system role, set by `WorkspaceShell` while it is
  // mounted (see the effect there). The dialog reads them to filter its
  // workspace and admin entries to what the signed-in role can actually open.
  const [viewer, setViewer] = useState<Viewer | null>(null)
  const [systemRole, setSystemRole] = useState<string | null>(null)

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
    <CommandPaletteContext
      value={{ open, setOpen, viewer, setViewer, systemRole, setSystemRole }}
    >
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
// The modern UA-CH `platform` first, with the deprecated-but-universal
// `navigator.platform` behind it: `userAgentData` is absent on Firefox and
// pre-2026 Safari, and both of those run on Macs that own the ⌘ half of the
// shortcut — a missing fallback would label every one of them "Ctrl K".
type NavigatorWithUaData = Navigator & {
  readonly userAgentData?: { readonly platform: string }
}

function isMacPlatform(): boolean {
  // SAFETY: the assertion only adds the UA-CH surface the DOM lib's
  // `Navigator` lacks; the property is optional, so a browser without it
  // falls through to `navigator.platform` below.
  // oxlint-disable-next-line effect/noAs -- structural probe of a DOM API the lib predates, not a widening
  const uaData = (navigator as NavigatorWithUaData).userAgentData
  const platform = uaData?.platform ?? navigator.platform
  return platform.toUpperCase().includes('MAC')
}

export function SearchButton() {
  const value = use(CommandPaletteContext)
  const isMac = useClientValue(isMacPlatform, true)

  return (
    <>
      {/* Icon-only below md: below that width the full button is
          `hidden`, which left touch users with no way to open the
          palette except the ⌘K shortcut they do not have. */}
      <Button
        variant="outline"
        size="icon"
        onClick={() => value?.setOpen(true)}
        onMouseEnter={preloadCommandPalette}
        onFocus={preloadCommandPalette}
        aria-label={m.common_search()}
        className="md:hidden"
      >
        <SearchIcon className="size-4" />
      </Button>
      <Button
        variant="outline"
        onClick={() => value?.setOpen(true)}
        onMouseEnter={preloadCommandPalette}
        onFocus={preloadCommandPalette}
        aria-label={m.common_search()}
        className="hidden h-9 w-56 gap-2 rounded-md px-3 text-sm text-muted-foreground md:flex"
      >
        <SearchIcon className="size-4" />
        <span className="flex-1 text-left">{m.common_search_placeholder()}</span>
        <kbd className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-2xs">
          {isMac ? '⌘K' : 'Ctrl K'}
        </kbd>
      </Button>
    </>
  )
}
