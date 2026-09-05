import { createFileRoute } from '@tanstack/react-router'
import { pageTitle } from '@/components/page/page-title'
import { RoutePending } from '@/components/route-pending'
import { WorkspaceBillingPage } from '@/components/workspace-billing-page'
import { loadWorkspaceBilling } from '@/lib/server/billing'

// The auth gate lives on the /workspaces layout route (workspaces.tsx);
// `context.session` arrives from there.
export const Route = createFileRoute('/workspaces/$workspaceSlug/billing')({
  loader: ({ params, context }) =>
    loadWorkspaceBilling({
      workspaceSlug: params.workspaceSlug,
      userId: context.session.user.id
    }),
  pendingComponent: RoutePending,
  component: WorkspaceBillingRoute,
  head: ({ params }) => ({
    meta: [{ title: pageTitle('Billing', params.workspaceSlug) }]
  })
})

/**
 * The route's thin wrapper: reads the params and loader data the router
 * resolved, and hands them to the page — the same split every workspace route
 * uses, so the page renders from a test with plain props. The page itself
 * lives in `components/workspace-billing-page.tsx` — a page exported from the
 * route file would pin its import graph into the route tree every page
 * preloads.
 */
function WorkspaceBillingRoute() {
  const { workspaceSlug } = Route.useParams()
  const data = Route.useLoaderData()
  const systemRole = Route.useRouteContext().session.user.role
  return (
    <WorkspaceBillingPage
      workspaceSlug={workspaceSlug}
      data={data}
      systemRole={systemRole}
    />
  )
}
