import { createContext } from 'react'
import { type Viewer } from '@/lib/permissions'

type CommandPaletteContextValue = {
  readonly state: { readonly open: boolean }
  readonly actions: { readonly setOpen: (open: boolean) => void }
  readonly meta: {
    readonly viewer: Viewer
    readonly systemRole: string | null
  }
}

export const CommandPaletteContext = createContext<CommandPaletteContextValue | null>(
  null
)
