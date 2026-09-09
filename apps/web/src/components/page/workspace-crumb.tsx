import { WorkspaceLink } from '@/components/workspace-link'
import { type ReactNode } from 'react'

/**
 * The one breadcrumb entry every workspace sub-page shares: the workspace
 * itself, linking back to its overview. The label defaults to the slug —
 * the stable identifier every loader carries — so pages whose payload has no
 * workspace name still render the same crumb.
 */
export function WorkspaceCrumb({
  workspaceSlug,
  children
}: {
  readonly workspaceSlug: string
  readonly children?: ReactNode
}) {
  return (
    <WorkspaceLink to="/workspaces/$workspaceSlug" workspaceSlug={workspaceSlug}>
      {children ?? workspaceSlug}
    </WorkspaceLink>
  )
}
