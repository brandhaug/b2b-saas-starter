import { useNavigate, useParams } from '@tanstack/react-router'
import { publicLinks } from '@/lib/content'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'

/**
 * The command palette's dialog, split from `command-palette.tsx` so cmdk and
 * its dependencies stay out of the entry chunk: this module is loaded only
 * when the palette opens (or is preloaded on search-button hover/focus).
 */
export default function CommandPaletteDialog({
  open,
  onOpenChange
}: {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
}) {
  const navigate = useNavigate()
  // Target the current workspace when inside one; outside a workspace the
  // command falls back to the workspace list — never a hardcoded workspace.
  const params = useParams({ strict: false })
  const workspaceSlug = params.workspaceSlug

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search docs, pages, and actions…" />
      <CommandList>
        <CommandEmpty>No result found.</CommandEmpty>
        <CommandGroup heading="Public pages">
          {publicLinks.map((link) => (
            <CommandItem
              key={link.to}
              onSelect={() => {
                onOpenChange(false)
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
              onOpenChange(false)
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
              onOpenChange(false)
              void navigate({ to: '/admin' })
            }}
          >
            Open admin dashboard
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
