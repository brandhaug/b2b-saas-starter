import { createContext } from 'react'

type CommandPaletteContextValue = {
  readonly open: boolean
  readonly setOpen: (open: boolean) => void
}

export const CommandPaletteContext = createContext<CommandPaletteContextValue | null>(
  null
)
