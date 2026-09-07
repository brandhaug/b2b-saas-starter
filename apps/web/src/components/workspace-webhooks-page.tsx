import { PageHeader } from '@/components/page/page-header'
import { WorkspaceCrumb } from '@/components/page/workspace-crumb'
import { WebhooksPanel } from '@/components/webhooks-panel'
import { WorkspaceShell } from '@/components/workspace-shell'
import { type WorkspaceWebhooksPayload } from '@/lib/server/webhooks'
import { m } from '@b2b-saas-starter/i18n/messages'

/**
 * The outbound-webhooks page. Lives beside the route file (not in it) so the
 * route module stays a thin shell the router's code splitting can reduce to
 * `createFileRoute` + lazy segments — an exported page in a route file pins
 * its whole import graph into the route tree every page preloads.
 *
 * Takes its params and payload as props so a test renders it without a route
 * tree.
 */
export function WorkspaceWebhooksPage({
  workspaceSlug,
  data,
  systemRole
}: {
  readonly workspaceSlug: string
  readonly data: WorkspaceWebhooksPayload
  /** The signed-in user's Better Auth system role, for the shell's admin link. */
  readonly systemRole?: string | null
}) {
  const { viewer, unreadCount, endpoints } = data

  return (
    <WorkspaceShell
      workspaceSlug={workspaceSlug}
      systemRole={systemRole}
      unreadCount={unreadCount}
      viewer={viewer}
    >
      <PageHeader
        breadcrumb={<WorkspaceCrumb workspaceSlug={workspaceSlug} />}
        title={m.nav_webhook_endpoints()}
        description={m.webhooks_description()}
      />
      <WebhooksPanel
        workspaceSlug={workspaceSlug}
        endpoints={endpoints}
        viewer={viewer}
      />
    </WorkspaceShell>
  )
}
