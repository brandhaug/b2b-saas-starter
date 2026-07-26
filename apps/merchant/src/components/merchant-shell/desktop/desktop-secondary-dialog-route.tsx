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
  const currentDescriptor = useEffectEvent(() => ({
    id,
    title,
    content: children,
    onAfterClose
  }))

  useLayoutEffect(() => {
    if (!desktopSecondaryDialog) return
    desktopSecondaryDialog.openSecondaryDialog(currentDescriptor())
  }, [contentRevision, desktopSecondaryDialog, id, title])

  return desktopSecondaryDialog ? null : children
}
