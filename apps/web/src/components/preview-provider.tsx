import { useState, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PreviewContext } from '@/lib/preview-context'

export function PreviewProvider({ children }: { readonly children: ReactNode }) {
  // Keep synthetic reads separate from queries cached by a signed-in visitor.
  // oxlint-disable-next-line react/hook-use-state -- this cache has the mounted preview's lifetime and is never replaced
  const [queryClient] = useState(() => new QueryClient())
  return (
    <PreviewContext value>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </PreviewContext>
  )
}
