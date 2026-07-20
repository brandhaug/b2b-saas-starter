import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'

type DesktopWorkspaceMemory = {
  readonly current: ReactNode
  readonly remember: (content: ReactNode) => void
}

const DesktopWorkspaceMemoryContext = createContext<DesktopWorkspaceMemory | null>(null)

export function DesktopWorkspaceMemoryProvider({
  fallback,
  children
}: {
  readonly fallback: ReactNode
  readonly children: ReactNode
}) {
  const [current, setCurrent] = useState<ReactNode>(null)
  const remember = useCallback((content: ReactNode) => setCurrent(content), [])

  return (
    <DesktopWorkspaceMemoryContext value={{ current: current ?? fallback, remember }}>
      {children}
    </DesktopWorkspaceMemoryContext>
  )
}

export function useDesktopWorkspaceMemory(): DesktopWorkspaceMemory {
  const memory = useContext(DesktopWorkspaceMemoryContext)
  if (!memory)
    throw new Error(
      'useDesktopWorkspaceMemory must be used within DesktopWorkspaceMemoryProvider.'
    )
  return memory
}

export function useRememberDesktopWorkspace(content: ReactNode): void {
  const { remember } = useDesktopWorkspaceMemory()
  useEffect(() => remember(content), [content, remember])
}
