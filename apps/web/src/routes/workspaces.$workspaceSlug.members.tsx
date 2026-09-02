import { createFileRoute } from '@tanstack/react-router'
import { MembersPanel } from '@/components/members-panel'
import { RoutePending } from '@/components/route-pending'
import { WorkspaceShell } from '@/components/workspace-shell'
import {
  loadWorkspaceMembers,
  type WorkspaceMembersPayload
} from '@/lib/server/workspace-members'

// The auth gate lives on the /workspaces layout route (workspaces.tsx);
// `context.session` arrives from there.
export const Route = createFileRoute('/workspaces/$workspaceSlug/members')({
  loader: ({ params, context }) =>
    loadWorkspaceMembers({
      workspaceSlug: params.workspaceSlug,
      userId: context.session.user.id
    }),
  pendingComponent: RoutePending,
  component: WorkspaceMembersRoute
})

/**
 * The route's thin wrapper: reads the params and loader data the router
 * resolved, and hands them to the page. Keeping the two apart is what lets the
 * page be rendered from a test with plain props — no route tree, no loader.
 */
function WorkspaceMembersRoute() {
  const { workspaceSlug } = Route.useParams()
  const data = Route.useLoaderData()
  return <WorkspaceMembersPage workspaceSlug={workspaceSlug} data={data} />
}

export function WorkspaceMembersPage({
  workspaceSlug,
  data
}: {
  readonly workspaceSlug: string
  readonly data: WorkspaceMembersPayload
}) {
  const { viewer, unreadCount, members } = data

  return (
    <WorkspaceShell
      workspaceSlug={workspaceSlug}
      title="Members"
      description="Everyone with access to this workspace."
      unreadCount={unreadCount}
      viewer={viewer}
    >
      <div className="grid gap-6">
        <MembersPanel workspaceSlug={workspaceSlug} members={members} viewer={viewer} />
      </div>
    </WorkspaceShell>
  )
}
