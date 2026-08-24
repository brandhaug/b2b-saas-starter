import { createFileRoute } from '@tanstack/react-router'
import { RoutePending } from '@/components/route-pending'
import { WorkspaceShell } from '@/components/workspace-shell'
import { WorkspaceBillingPage } from '@/components/workspace-billing'
import { viewerCan } from '@/lib/permissions'
import {
  loadWorkspaceBilling,
  type WorkspaceBillingPayload
} from '@/lib/server/billing'

// The auth gate lives on the /workspaces layout route (workspaces.tsx);
// `context.session` arrives from there.
export const Route = createFileRoute('/workspaces/$workspaceSlug/billing')({
  loader: ({ params, context }) =>
    loadWorkspaceBilling({
      workspaceSlug: params.workspaceSlug,
      userId: context.session.user.id
    }),
  pendingComponent: RoutePending,
  component: WorkspaceBillingRoute
})

/** Thin wrapper: hands the router's data to the page so tests render props. */
function WorkspaceBillingRoute() {
  const { workspaceSlug } = Route.useParams()
  const data = Route.useLoaderData()
  return <WorkspaceBillingPageWrapper slug={workspaceSlug} data={data} />
}

export function WorkspaceBillingPageWrapper({
  slug,
  data
}: {
  readonly slug: string
  readonly data: WorkspaceBillingPayload
}) {
  const canManageBilling =
    data.viewer !== null && viewerCan(data.viewer, { organization: ['update'] })
  return (
    <WorkspaceShell
      workspaceSlug={slug}
      title="Billing"
      description="Plan, entitlements, and checkout."
      unreadCount={data.unreadCount}
      canReadAuditLog={
        data.viewer !== null && viewerCan(data.viewer, { auditLog: ['read'] })
      }
    >
      <WorkspaceBillingPage
        workspaceSlug={slug}
        currentPlanId={data.currentPlanId}
        plans={data.plans}
        stripeConfigured={data.stripeConfigured}
        canManageBilling={canManageBilling}
      />
    </WorkspaceShell>
  )
}
