import { purchaseIntent } from '@/lib/purchase-intent'
import { createFileRoute } from '@tanstack/react-router'
import { pageTitle } from '@/components/page/page-title'
import { RoutePending } from '@/components/route-pending'
import { WorkspaceBillingPage } from '@/components/workspace-billing-page'
import { loadWorkspaceBillingServerFn } from '@/lib/server/billing'
import { m } from '@b2b-saas-starter/i18n/messages'
import { pickOptionalStrings } from '@/lib/utils'

type BillingSearch = {
  readonly checkout?: string | undefined
  readonly purchase?: string | undefined
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- the router hands the search record to this plain shape probe
function decodeBillingSearch(search: unknown): BillingSearch {
  const picked = pickOptionalStrings(search, ['checkout', 'purchase'])
  return {
    checkout: picked.checkout === 'success' ? 'success' : undefined,
    purchase: purchaseIntent(picked.purchase)?.planId
  }
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
  const { checkout, purchase } = Route.useSearch()
  const data = Route.useLoaderData()
  const systemRole = Route.useRouteContext().session.user.role
  return (
    <WorkspaceBillingPage
      purchaseIntent={purchaseIntent(purchase)}
      workspaceSlug={workspaceSlug}
      data={data}
      checkoutReturn={checkout === 'success'}
      systemRole={systemRole}
    />
  )
}
