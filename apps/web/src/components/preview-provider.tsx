import { useState, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PreviewContext, type PreviewWorkspace } from '@/lib/preview-context'

export function PreviewProvider({
  children,
  workspace
}: {
  readonly children: ReactNode
  /** The workspace the preview chrome names; datasets carry their own. */
  readonly workspace: PreviewWorkspace
}) {
  // Keep synthetic reads separate from queries cached by a signed-in visitor.
  // oxlint-disable-next-line react/hook-use-state -- this cache has the mounted preview's lifetime and is never replaced
  const [queryClient] = useState(() => new QueryClient())
  return (
    <PreviewContext value={workspace}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </PreviewContext>
  )
}
