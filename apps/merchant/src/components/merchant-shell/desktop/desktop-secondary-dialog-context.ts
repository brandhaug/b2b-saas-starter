import { createContext, useContext, type ReactNode } from 'react'

export type DesktopSecondaryDialogDescriptor = {
  readonly content: ReactNode
  readonly id: string
  readonly onAfterClose?: (() => void) | undefined
  readonly title: string
}

export type DesktopSecondaryDialogContextValue = {
  readonly openSecondaryDialog: (descriptor: DesktopSecondaryDialogDescriptor) => void
}

export const DesktopSecondaryDialogContext =
  createContext<DesktopSecondaryDialogContextValue | null>(null)

export function useDesktopSecondaryDialog() {
  return useContext(DesktopSecondaryDialogContext)
}
