import { type ReactNode } from 'react'
import { CommandPaletteProvider } from '@/components/command-palette'
import { AppFrame } from '@/components/app-frame'
import { DEMO_WORKSPACE_SLUG } from '@/lib/demo-workspace'
import { seedWorkspaceRecord } from '@b2b-saas-starter/capabilities/governance/workspace-identity.seed'
import { type WorkspaceViewer } from '@/lib/permissions'

const workspace = { slug: DEMO_WORKSPACE_SLUG, name: seedWorkspaceRecord.name }
const viewer = { role: 'owner' } satisfies WorkspaceViewer

export function PreviewShell({
  children,
  layout,
  unreadCount
}: {
  readonly layout?: 'standard' | 'wide' | undefined
  readonly children: ReactNode
  readonly unreadCount?: number | undefined
}) {
  return (
    <CommandPaletteProvider viewer={viewer}>
      <AppFrame
        workspace={workspace}
        viewer={viewer}
        layout={layout}
        unreadCount={unreadCount}
      >
        {children}
      </AppFrame>
    </CommandPaletteProvider>
  )
}
