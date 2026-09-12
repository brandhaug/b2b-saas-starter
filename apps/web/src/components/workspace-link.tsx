import { type WorkspaceView } from '@/lib/workspace-view'
import { type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { usePreview } from '@/lib/preview-context'
import { previewWorkspaceLocation } from '@/lib/preview-navigation'
import { type WorkspaceNavTarget } from '@/lib/workspace-nav'

export function WorkspaceLink({
  to,
  workspaceSlug,
  className,
  search,
  children
}: {
  readonly search?: WorkspaceView | undefined
  readonly to: WorkspaceNavTarget
  readonly workspaceSlug: string
  readonly className?: string
  readonly children: ReactNode
}) {
  const preview = usePreview()
  const location = preview
    ? previewWorkspaceLocation(to)
    : { to, params: { workspaceSlug } }
  return (
    <Link {...location} search={search ?? {}} className={className}>
      {children}
    </Link>
  )
}
