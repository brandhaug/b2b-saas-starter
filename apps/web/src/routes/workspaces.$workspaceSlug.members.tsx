import { createFileRoute, Link } from '@tanstack/react-router'
import { InvitationPanel } from '@/components/invitation-panel'
import { MembersPanel } from '@/components/members-panel'
import { PageHeader } from '@/components/page/page-header'
import { pageTitle } from '@/components/page/page-title'
import { WorkspaceCrumb } from '@/components/page/workspace-crumb'
import { RoutePending } from '@/components/route-pending'
import { WorkspaceShell } from '@/components/workspace-shell'
import { Alert, AlertDescription } from '@/components/ui/alert'
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
  component: WorkspaceMembersRoute,
  head: ({ params }) => ({
    meta: [{ title: pageTitle('Members', params.workspaceSlug) }]
  })
})

/**
 * The route's thin wrapper: reads the params and loader data the router
 * resolved, and hands them to the page. Keeping the two apart is what lets the
 * page be rendered from a test with plain props — no route tree, no loader.
 */
function WorkspaceMembersRoute() {
  const { workspaceSlug } = Route.useParams()
  const data = Route.useLoaderData()
  const systemRole = Route.useRouteContext().session.user.role
  return (
    <WorkspaceMembersPage
      workspaceSlug={workspaceSlug}
      data={data}
      systemRole={systemRole}
    />
  )
}

export function WorkspaceMembersPage({
  workspaceSlug,
  data,
  systemRole
}: {
  readonly workspaceSlug: string
  readonly data: WorkspaceMembersPayload
  /** The signed-in user's Better Auth system role, for the shell's admin link. */
  readonly systemRole?: string | null
}) {
  const { viewer, unreadCount, members, invitations, seatUsage } = data

  return (
    <WorkspaceShell
      workspaceSlug={workspaceSlug}
      systemRole={systemRole}
      unreadCount={unreadCount}
      viewer={viewer}
    >
      <PageHeader
        breadcrumb={<WorkspaceCrumb workspaceSlug={workspaceSlug} />}
        title="Members"
        description="Everyone with access to this workspace, and everyone on their way in."
      />
      {/* The seat half of the plan gate, as a prompt rather than a refusal:
          the workspace may always add Members, but a flat plan past its
          included seats asks for an upgrade here. */}
      {seatUsage.overLimit ? (
        <Alert>
          <AlertDescription>
            This workspace has {seatUsage.used} members — more than the{' '}
            {seatUsage.included} seats its plan includes.{' '}
            <Link
              to="/workspaces/$workspaceSlug/billing"
              params={{ workspaceSlug }}
              className="font-medium text-foreground underline underline-offset-4"
            >
              Upgrade the plan
            </Link>{' '}
            to cover the whole team.
          </AlertDescription>
        </Alert>
      ) : null}
      <MembersPanel workspaceSlug={workspaceSlug} members={members} viewer={viewer} />
      {/* `null` means this actor may not read the invitation segment; the
          panel gates its own form against `invitation:create`. */}
      {invitations === null ? null : (
        <InvitationPanel
          workspaceSlug={workspaceSlug}
          viewer={viewer}
          invitations={invitations}
        />
      )}
    </WorkspaceShell>
  )
}
