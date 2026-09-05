import { Link } from '@tanstack/react-router'
import { InvitationPanel } from '@/components/invitation-panel'
import { MembersPanel } from '@/components/members-panel'
import { PageHeader } from '@/components/page/page-header'
import { WorkspaceCrumb } from '@/components/page/workspace-crumb'
import { WorkspaceShell } from '@/components/workspace-shell'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { type WorkspaceMembersPayload } from '@/lib/server/workspace-members'

/**
 * The workspace roster page. Lives beside the route file (not in it) so the
 * route module stays a thin shell the router's code splitting can reduce to
 * `createFileRoute` + lazy segments — an exported page in a route file pins
 * its whole import graph into the route tree every page preloads.
 *
 * Takes its params and payload as props so a test renders it without a route
 * tree.
 */
export function WorkspaceMembersPage({
  workspaceSlug,
  data,
  systemRole,
  actorUserId
}: {
  readonly workspaceSlug: string
  readonly data: WorkspaceMembersPayload
  /** The signed-in user's Better Auth system role, for the shell's admin link. */
  readonly systemRole?: string | null
  /** The signed-in user's id — the roster's own-row verb (leave) keys on it. */
  readonly actorUserId: string
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
            This workspace has {seatUsage.used} members, more than the{' '}
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
      <MembersPanel
        workspaceSlug={workspaceSlug}
        members={members}
        viewer={viewer}
        actorUserId={actorUserId}
      />
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
