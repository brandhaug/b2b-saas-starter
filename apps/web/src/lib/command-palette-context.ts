import { createContext } from 'react'
import { type Viewer } from '@/lib/permissions'

type CommandPaletteContextValue = {
  readonly open: boolean
  readonly setOpen: (open: boolean) => void
  readonly viewer: Viewer
  readonly systemRole: string | null
}

export const CommandPaletteContext = createContext<CommandPaletteContextValue | null>(
  null
)
