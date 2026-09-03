import { createFileRoute } from '@tanstack/react-router'
import { ApiTokensPanel } from '@/components/api-tokens-panel'
import { PageHeader } from '@/components/page/page-header'
import { pageTitle } from '@/components/page/page-title'
import { WorkspaceCrumb } from '@/components/page/workspace-crumb'
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
  component: WorkspaceApiTokensRoute,
  head: ({ params }) => ({
    meta: [{ title: pageTitle('API tokens', params.workspaceSlug) }]
  })
})

/**
 * The route's thin wrapper: reads the params and loader data the router
 * resolved, and hands them to the page. Keeping the two apart is what lets the
 * page be rendered from a test with plain props — no route tree, no loader.
 */
function WorkspaceApiTokensRoute() {
  const { workspaceSlug } = Route.useParams()
  const data = Route.useLoaderData()
  const systemRole = Route.useRouteContext().session.user.role
  return (
    <WorkspaceApiTokensPage
      workspaceSlug={workspaceSlug}
      data={data}
      systemRole={systemRole}
    />
  )
}

export function WorkspaceApiTokensPage({
  workspaceSlug,
  data,
  systemRole
}: {
  readonly workspaceSlug: string
  readonly data: WorkspaceApiTokensPayload
  /** The signed-in user's Better Auth system role, for the shell's admin link. */
  readonly systemRole?: string | null
}) {
  const { viewer, unreadCount, tokens } = data

  return (
    <WorkspaceShell
      workspaceSlug={workspaceSlug}
      systemRole={systemRole}
      unreadCount={unreadCount}
      viewer={viewer}
    >
      <PageHeader
        breadcrumb={<WorkspaceCrumb workspaceSlug={workspaceSlug} />}
        title="API tokens"
        description="Workspace-scoped bearer tokens for the API."
      />
      <ApiTokensPanel workspaceSlug={workspaceSlug} tokens={tokens} viewer={viewer} />
    </WorkspaceShell>
  )
}
