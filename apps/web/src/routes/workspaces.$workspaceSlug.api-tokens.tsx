import { createFileRoute } from '@tanstack/react-router'
import { ApiTokensPanel } from '@/components/api-tokens-panel'
import { RoutePending } from '@/components/route-pending'
import { WorkspaceShell } from '@/components/workspace-shell'
import {
  loadWorkspaceApiTokens,
  type WorkspaceApiTokensPayload
} from '@/lib/server/api-tokens'

// The auth gate lives on the /workspaces layout route (workspaces.tsx);
// `context.session` arrives from there. The page's own read permission
// (`apiToken:list`) is a hard gate inside the loader.
export const Route = createFileRoute('/workspaces/$workspaceSlug/api-tokens')({
  loader: ({ params, context }) =>
    loadWorkspaceApiTokens({
      workspaceSlug: params.workspaceSlug,
      userId: context.session.user.id
    }),
  pendingComponent: RoutePending,
  component: WorkspaceApiTokensRoute
})

/**
 * The route's thin wrapper: reads the params and loader data the router
 * resolved, and hands them to the page. Keeping the two apart is what lets the
 * page be rendered from a test with plain props — no route tree, no loader.
 */
function WorkspaceApiTokensRoute() {
  const { workspaceSlug } = Route.useParams()
  const data = Route.useLoaderData()
  return <WorkspaceApiTokensPage workspaceSlug={workspaceSlug} data={data} />
}

export function WorkspaceApiTokensPage({
  workspaceSlug,
  data
}: {
  readonly workspaceSlug: string
  readonly data: WorkspaceApiTokensPayload
}) {
  const { viewer, unreadCount, tokens } = data

  return (
    <WorkspaceShell
      workspaceSlug={workspaceSlug}
      title="API tokens"
      description="Workspace-scoped bearer tokens for the API."
      unreadCount={unreadCount}
      viewer={viewer}
    >
      <div className="grid gap-6">
        <ApiTokensPanel workspaceSlug={workspaceSlug} tokens={tokens} viewer={viewer} />
      </div>
    </WorkspaceShell>
  )
}
