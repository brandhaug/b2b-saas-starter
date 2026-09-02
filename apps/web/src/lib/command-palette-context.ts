import { createContext } from 'react'
import { type Viewer } from '@/lib/permissions'

type CommandPaletteContextValue = {
  readonly open: boolean
  readonly setOpen: (open: boolean) => void
  /**
   * The workspace viewer of the page rendering `WorkspaceShell`, or `null`
   * outside the shell (public pages). The palette filters its workspace
   * entries with it, so a member is never offered a section their role
   * cannot read.
   */
  readonly viewer: Viewer | null
  readonly setViewer: (viewer: Viewer | null) => void
  /** The signed-in user's Better Auth system role, when known. */
  readonly systemRole: string | null
  readonly setSystemRole: (role: string | null) => void
}

export const CommandPaletteContext = createContext<CommandPaletteContextValue | null>(
  null
)
