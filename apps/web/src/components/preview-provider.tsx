import { useState, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { seedWorkspaceRecord } from '@b2b-saas-starter/capabilities/governance/workspace-identity.seed'
import { DEMO_WORKSPACE_SLUG } from '@/lib/demo-workspace'
import { PreviewContext, type PreviewWorkspace } from '@/lib/preview-context'

// The preview names the same workspace the seed fixture defines, so the demo
// chrome cannot drift from the workspace the fixtures render inside it.
const seedPreviewWorkspace: PreviewWorkspace = {
  slug: DEMO_WORKSPACE_SLUG,
  name: seedWorkspaceRecord.name
}

export function PreviewProvider({
  children,
  workspace = seedPreviewWorkspace
}: {
  readonly children: ReactNode
  readonly workspace?: PreviewWorkspace | undefined
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
