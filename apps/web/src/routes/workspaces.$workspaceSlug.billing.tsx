import { createFileRoute } from '@tanstack/react-router'
import { RoutePending } from '@/components/route-pending'
import { WorkspaceShell } from '@/components/workspace-shell'
import { BillingPlans } from '@/components/workspace-billing'
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

/**
 * The route's thin wrapper: reads the params and loader data the router
 * resolved, and hands them to the page — the same split every workspace route
 * uses, so the page renders from a test with plain props.
 */
function WorkspaceBillingRoute() {
  const { workspaceSlug } = Route.useParams()
  const data = Route.useLoaderData()
  return <WorkspaceBillingPage workspaceSlug={workspaceSlug} data={data} />
}

export function WorkspaceBillingPage({
  workspaceSlug,
  data
}: {
  readonly workspaceSlug: string
  readonly data: WorkspaceBillingPayload
}) {
  const canManageBilling =
    data.viewer !== null && viewerCan(data.viewer, { organization: ['update'] })
  return (
    <WorkspaceShell
      workspaceSlug={workspaceSlug}
      title="Billing"
      description="Plan, entitlements, and checkout."
      unreadCount={data.unreadCount}
      viewer={data.viewer}
    >
      <BillingPlans
        workspaceSlug={workspaceSlug}
        currentPlanId={data.currentPlanId}
        plans={data.plans}
        stripeConfigured={data.stripeConfigured}
        canManageBilling={canManageBilling}
      />
    </WorkspaceShell>
  )
}
