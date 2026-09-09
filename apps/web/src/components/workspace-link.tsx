import { type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { usePreview } from '@/lib/preview-context'
import { previewWorkspaceLocation } from '@/lib/preview-navigation'
import { type WorkspaceNavTarget } from '@/lib/workspace-nav'

export function WorkspaceLink({
  to,
  workspaceSlug,
  className,
  children
}: {
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
    <Link {...location} className={className}>
      {children}
    </Link>
  )
}
