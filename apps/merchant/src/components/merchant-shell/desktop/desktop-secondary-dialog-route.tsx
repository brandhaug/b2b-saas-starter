import { useLocation } from '@tanstack/react-router'
import { useEffectEvent, useLayoutEffect, type ReactNode } from 'react'
import { useDesktopSecondaryDialog } from './desktop-secondary-dialog-context.ts'

export function DesktopSecondaryDialogRoute({
  children,
  contentRevision,
  id,
  onAfterClose,
  title
}: {
  readonly children: ReactNode
  readonly contentRevision?: string | number | undefined
  readonly id: string
  readonly onAfterClose: () => void
  readonly title: string
}) {
  const desktopSecondaryDialog = useDesktopSecondaryDialog()
  const location = useLocation()
  const currentDescriptor = useEffectEvent(() => ({
    id,
    title,
    content: children,
    onAfterClose,
    sourcePathname: location.pathname
  }))

  useLayoutEffect(() => {
    if (!desktopSecondaryDialog) return
    desktopSecondaryDialog.openSecondaryDialog(currentDescriptor())
  }, [contentRevision, desktopSecondaryDialog, id, location.pathname, title])

  return desktopSecondaryDialog ? null : children
}
