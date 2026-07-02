import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from '@tanstack/react-router'
import { SearchIcon } from 'lucide-react'
import { publicLinks } from '@/lib/content'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import { CommandPaletteContext } from '@/lib/command-palette-context'

export function CommandPaletteProvider({ children }: { readonly children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  // Target the current workspace when inside one; outside a workspace the
  // command falls back to the workspace list — never a hardcoded workspace.
  const params = useParams({ strict: false })
  const workspaceSlug = params.workspaceSlug

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        setOpen((current) => !current)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <CommandPaletteContext value={{ open, setOpen }}>
      {children}
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Search docs, pages, and actions..." />
        <CommandList>
          <CommandEmpty>No result found.</CommandEmpty>
          <CommandGroup heading="Public pages">
            {publicLinks.map((link) => (
              <CommandItem
                key={link.to}
                onSelect={() => {
                  setOpen(false)
                  void navigate({ to: link.to })
                }}
              >
                {link.label}
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandGroup heading="Workspace">
            <CommandItem
              onSelect={() => {
                setOpen(false)
                void (workspaceSlug
                  ? navigate({
                      to: '/workspaces/$workspaceSlug',
                      params: { workspaceSlug }
                    })
                  : navigate({ to: '/workspaces' }))
              }}
            >
              {workspaceSlug ? 'Open workspace overview' : 'Open workspaces'}
            </CommandItem>
            <CommandItem
              onSelect={() => {
                setOpen(false)
                void navigate({ to: '/admin' })
              }}
            >
              Open admin dashboard
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </CommandPaletteContext>
  )
}

export function SearchButton() {
  const [isMac, setIsMac] = useState(true)

  useEffect(() => {
    setIsMac(navigator.platform.toUpperCase().includes('MAC'))
  }, [])

  return (
    <CommandPaletteContext.Consumer>
      {(value) => (
        <button
          type="button"
          onClick={() => value?.setOpen(true)}
          aria-label="Search"
          className="hidden h-9 w-56 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm text-muted-foreground transition-colors hover:text-foreground md:flex"
        >
          <SearchIcon className="size-4" />
          <span className="flex-1 text-left">Search...</span>
          <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">
            {isMac ? '⌘K' : 'Ctrl K'}
          </kbd>
        </button>
      )}
    </CommandPaletteContext.Consumer>
  )
}
