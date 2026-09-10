import { createFileRoute } from '@tanstack/react-router'
import { pageTitle } from '@/components/page/page-title'
import { RoutePending } from '@/components/route-pending'
import { workspaceRouteError } from '@/components/workspace-route-error'
import { WorkspaceWebhooksPage } from '@/components/workspace-webhooks-page'
import { loadWorkspaceWebhooksServerFn } from '@/lib/server/webhooks'
import { m } from '@b2b-saas-starter/i18n/messages'

/**
 * A member without the page's read permission meets an intended page, not a
 * crash screen: the denial renders inside the workspace shell.
 */
const WebhooksRouteError = workspaceRouteError({
  deniedTitle: m.webhooks_access_denied,
  deniedDescription: m.webhooks_forbidden_description,
  failedTitle: m.webhooks_unavailable,
  failedDescription: m.webhooks_load_failed
})

// The auth gate lives on the /workspaces layout route (workspaces.tsx);
// `context.session` arrives from there. The page's own read permission
// (`webhook:list`) is a hard gate inside the loader.
export const Route = createFileRoute('/workspaces/$workspaceSlug/webhooks')({
  loader: ({ params }) =>
    loadWorkspaceWebhooksServerFn({
      data: { workspaceSlug: params.workspaceSlug }
    }),
  pendingComponent: RoutePending,
  errorComponent: WebhooksRouteError,
  component: WorkspaceWebhooksRoute,
  head: ({ params }) => ({
    meta: [{ title: pageTitle(m.public_meta_webhooks(), params.workspaceSlug) }]
  })
})

/**
 * The route's thin wrapper: reads the params and loader data the router
 * resolved, and hands them to the page. Keeping the two apart is what lets the
 * page be rendered from a test with plain props — no route tree, no loader.
 * The page itself lives in `components/workspace-webhooks-page.tsx` — a page
 * exported from the route file would pin its import graph into the route tree
 * every page preloads.
 */
function WorkspaceWebhooksRoute() {
  const { workspaceSlug } = Route.useParams()
  const data = Route.useLoaderData()
  const systemRole = Route.useRouteContext().session.user.role
  return (
    <WorkspaceWebhooksPage
      workspaceSlug={workspaceSlug}
      data={data}
      systemRole={systemRole}
    />
  )
}
