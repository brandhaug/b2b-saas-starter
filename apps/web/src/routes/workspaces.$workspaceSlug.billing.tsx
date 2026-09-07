import { createFileRoute } from '@tanstack/react-router'
import { pageTitle } from '@/components/page/page-title'
import { RoutePending } from '@/components/route-pending'
import { WorkspaceBillingPage } from '@/components/workspace-billing-page'
import { loadWorkspaceBillingServerFn } from '@/lib/server/billing'
import { m } from '@b2b-saas-starter/i18n/messages'
import { pickOptionalStrings } from '@/lib/utils'

type BillingSearch = { readonly checkout?: string | undefined }

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- the router hands the search record to this plain shape probe
function decodeBillingSearch(search: unknown): BillingSearch {
  const picked = pickOptionalStrings(search, ['checkout'])
  return picked.checkout === 'success' ? picked : {}
}

// The auth gate lives on the /workspaces layout route (workspaces.tsx);
// `context.session` arrives from there.
export const Route = createFileRoute('/workspaces/$workspaceSlug/billing')({
  validateSearch: (search) => decodeBillingSearch(search),
  loader: ({ params }) =>
    loadWorkspaceBillingServerFn({
      data: { workspaceSlug: params.workspaceSlug }
    }),
  pendingComponent: RoutePending,
  component: WorkspaceBillingRoute,
  head: ({ params }) => ({
    meta: [{ title: pageTitle(m.public_meta_billing(), params.workspaceSlug) }]
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
  const { checkout } = Route.useSearch()
  const data = Route.useLoaderData()
  const systemRole = Route.useRouteContext().session.user.role
  return (
    <WorkspaceBillingPage
      workspaceSlug={workspaceSlug}
      data={data}
      checkoutReturn={checkout === 'success'}
      systemRole={systemRole}
    />
  )
}
