import { use, type ReactNode } from 'react'
import { useNavigate, useParams } from '@tanstack/react-router'
import { UserRoundIcon } from 'lucide-react'
import { publicLinks } from '@/lib/content'
import { viewerCan } from '@/lib/permissions'
import { WORKSPACE_NAV } from '@/lib/workspace-nav'
import { CommandPaletteContext } from '@/lib/command-palette-context'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'

/** The palette's context value, flattened for the dialog's two consumers. */
function usePaletteSession() {
  const value = use(CommandPaletteContext)
  return {
    viewer: value?.viewer ?? null,
    systemRole: value?.systemRole ?? null
  }
}

/**
 * The command palette's dialog, split from `command-palette.tsx` so cmdk and
 * its dependencies stay out of the entry chunk: this module is loaded only
 * when the palette opens (or is preloaded on search-button hover/focus).
 *
 * Workspace entries come from the same `WORKSPACE_NAV` table the sidebar
 * renders, filtered by the same `viewerCan` — the palette and the sidebar
 * cannot drift, and a member is never offered a section their role cannot
 * open. The admin entry renders only for a system admin, who is the only
 * role the route lets through.
 */
// Loaded via dynamic import() in command-palette-loader.ts.
// fallow-ignore-next-line unused-export
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
  const { viewer, systemRole } = usePaletteSession()

  function close() {
    onOpenChange(false)
  }

  const rows: Array<ReactNode> = []
  if (workspaceSlug !== undefined && viewer !== null) {
    for (const row of WORKSPACE_NAV) {
      if (row.permission !== undefined && !viewerCan(viewer, row.permission)) {
        continue
      }
      const to = row.to
      rows.push(
        <CommandItem
          key={row.to}
          onSelect={() => {
            close()
            void navigate({ to, params: { workspaceSlug } })
          }}
        >
          {row.label}
        </CommandItem>
      )
    }
  } else {
    rows.push(
      <CommandItem
        key="workspaces"
        onSelect={() => {
          close()
          void navigate({ to: '/workspaces' })
        }}
      >
        Open workspaces
      </CommandItem>
    )
  }
  rows.push(
    <CommandItem
      key="account"
      onSelect={() => {
        close()
        void navigate({ to: '/account' })
      }}
    >
      <UserRoundIcon aria-hidden className="size-4" />
      Account
    </CommandItem>
  )
  if (systemRole === 'admin') {
    rows.push(
      <CommandItem
        key="admin"
        onSelect={() => {
          close()
          void navigate({ to: '/admin' })
        }}
      >
        System admin
      </CommandItem>
    )
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="Search docs, pages, and actions…"
        aria-label="Search docs, pages, and actions"
      />
      <CommandList>
        <CommandEmpty>No result found.</CommandEmpty>
        <CommandGroup heading="Public pages">
          {publicLinks.map((link) => (
            <CommandItem
              key={link.to}
              onSelect={() => {
                close()
                void navigate({ to: link.to })
              }}
            >
              {link.label}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Workspace">{rows}</CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
