import { useNavigate } from '@tanstack/react-router'
import { CheckIcon, ChevronsUpDownIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuGroupLabel,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { findWorkspace, useWorkspaceDirectory } from '@/lib/workspace-directory'

/**
 * The workspace switcher at the top of the sidebar: the current workspace's
 * name opening a menu of the user's memberships. Choosing one navigates to its
 * overview. Reads the directory the `/workspaces` layout publishes, so every
 * workspace page — not just the list — can switch from here. With no directory
 * in context it renders the current name as a static label: `fallbackName`
 * covers the surfaces that anchor to a remembered workspace instead (e.g.
 * /account), where the slug is known but the directory is not.
 */
export function WorkspaceSwitcher({
  workspaceSlug,
  fallbackName,
  onNavigate
}: {
  readonly workspaceSlug: string
  /** Display name when no directory is in context; the slug is the last resort. */
  readonly fallbackName?: string | undefined
  /** Closes the mobile sheet after a choice, when rendered inside it. */
  readonly onNavigate?: (() => void) | undefined
}) {
  const directory = useWorkspaceDirectory()
  const navigate = useNavigate()
  const current = findWorkspace(directory, workspaceSlug)

  if (directory === null || directory.length === 0 || current === undefined) {
    // No directory (system surfaces) or nothing to switch between: the
    // current name is a label, not a menu.
    return (
      <div className="truncate rounded-md border border-sidebar-border px-3 py-2 text-sm font-medium text-sidebar-foreground">
        {current?.name ?? fallbackName ?? workspaceSlug}
      </div>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            className="w-full justify-between gap-2 border-sidebar-border bg-sidebar-accent/50 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            aria-label="Switch workspace"
          />
        }
      >
        <span className="min-w-0 truncate">{current.name}</span>
        <ChevronsUpDownIcon className="size-4 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-(--anchor-width)">
        <DropdownMenuGroup>
          <DropdownMenuGroupLabel>Workspaces</DropdownMenuGroupLabel>
          {directory.map(({ workspace }) => (
            <DropdownMenuItem
              key={workspace.id}
              // The current workspace is marked, not disabled: picking it is
              // harmless (it navigates to its overview) and the check explains
              // the mark to screen readers via the item's name.
              onClick={() => {
                onNavigate?.()
                void navigate({
                  to: '/workspaces/$workspaceSlug',
                  params: { workspaceSlug: workspace.slug }
                })
              }}
            >
              <span className="grid size-4 place-items-center">
                {workspace.slug === workspaceSlug ? (
                  <CheckIcon className="size-4" />
                ) : null}
              </span>
              <span className="min-w-0 truncate">{workspace.name}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
