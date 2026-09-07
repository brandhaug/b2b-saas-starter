import { useQuery } from '@tanstack/react-query'
import {
  loadWorkspaceBillingServerFn,
  type WorkspaceBillingPayload
} from '@/lib/server/billing'
import { PageHeader } from '@/components/page/page-header'
import { WorkspaceCrumb } from '@/components/page/workspace-crumb'
import { WorkspaceShell } from '@/components/workspace-shell'
import { BillingPlans } from '@/components/workspace-billing'
import { viewerCan } from '@/lib/permissions'
import { m } from '@b2b-saas-starter/i18n/messages'

/**
 * The billing page. Lives beside the route file (not in it) so the route
 * module stays a thin shell the router's code splitting can reduce to
 * `createFileRoute` + lazy segments — an exported page in a route file pins
 * its whole import graph into the route tree every page preloads.
 *
 * Takes its params and payload as props so a test renders it without a route
 * tree.
 */
export function WorkspaceBillingPage({
  workspaceSlug,
  data: initialData,
  systemRole
}: {
  readonly workspaceSlug: string
  readonly data: WorkspaceBillingPayload
  /** The signed-in user's Better Auth system role, for the shell's admin link. */
  readonly systemRole?: string | null
}) {
  const { data } = useQuery({
    queryKey: ['workspace-billing', workspaceSlug],
    queryFn: () => loadWorkspaceBillingServerFn({ data: { workspaceSlug } }),
    initialData,
    refetchInterval: (query) => {
      if (!query.state.data?.stripeConfigured) {
        return false
      }
      return query.state.data.synchronization.status === 'pending' ? 10_000 : 30_000
    }
  })
  const canManageBilling =
    data.viewer !== null && viewerCan(data.viewer, { organization: ['update'] })
  return (
    <WorkspaceShell
      workspaceSlug={workspaceSlug}
      systemRole={systemRole}
      unreadCount={data.unreadCount}
      viewer={data.viewer}
    >
      <PageHeader
        breadcrumb={<WorkspaceCrumb workspaceSlug={workspaceSlug} />}
        title={m.nav_billing()}
        description={m.billing_description()}
      />
      <BillingPlans
        workspaceSlug={workspaceSlug}
        currentPlanId={data.currentPlanId}
        plans={data.plans}
        stripeConfigured={data.stripeConfigured}
        synchronization={data.synchronization}
        canManageBilling={canManageBilling}
      />
    </WorkspaceShell>
  )
}
