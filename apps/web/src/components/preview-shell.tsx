import { type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { WorkspaceChrome } from '@/components/workspace-chrome'
import { type PreviewWorkspace } from '@/lib/preview-context'
import { m } from '@b2b-saas-starter/i18n/messages'
import { type WorkspaceViewer } from '@/lib/permissions'

const viewer = { role: 'owner' } satisfies WorkspaceViewer

/**
 * The `/demo` shell: the shared chrome with a fixed synthetic owner, links that
 * stay inside `/demo`, and the preview notice. Deliberately no session, account
 * menu, impersonation banner, support footer or workspace memory — nothing here
 * reads or acts on a signed-in identity.
 */
export function PreviewShell({
  workspace,
  children,
  layout = 'standard',
  unreadCount
}: {
  readonly workspace: PreviewWorkspace
  readonly layout?: 'standard' | 'wide' | undefined
  readonly children: ReactNode
  readonly unreadCount: number | null
}) {
  return (
    <WorkspaceChrome
      layout={layout}
      workspace={workspace}
      viewer={viewer}
      systemRole={null}
      home={
        <Link to="/demo" title={workspace.name}>
          {workspace.name}
        </Link>
      }
      notifications={
        unreadCount === null
          ? null
          : {
              count: unreadCount,
              link: <Link to="/demo/$section" params={{ section: 'notifications' }} />
            }
      }
      notice={
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card/40 px-4 py-2 text-muted-foreground sm:px-8">
          <p className="text-sm">{m.demo_preview_notice()}</p>
          <Button
            nativeButton={false}
            variant="outline"
            size="xs"
            render={<Link to="/sign-in" />}
          >
            {m.demo_try_sign_in()}
          </Button>
        </div>
      }
    >
      {children}
    </WorkspaceChrome>
  )
}
