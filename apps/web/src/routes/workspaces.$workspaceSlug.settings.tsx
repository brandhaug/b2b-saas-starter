import { Link, createFileRoute } from '@tanstack/react-router'
import { InvitationPanel } from '@/components/invitation-panel'
import { RoutePending } from '@/components/route-pending'
import { WorkspaceShell, type SignOut } from '@/components/workspace-shell'
import {
  WorkspaceGeneralSettings,
  type DeleteWorkspace,
  type RenameWorkspace
} from '@/components/workspace-general-settings'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { viewerCan } from '@/lib/permissions'
import {
  loadWorkspaceSettings,
  type WorkspaceSettingsPayload
} from '@/lib/server/workspace-settings'

// The auth gate lives on the /workspaces layout route (workspaces.tsx);
// `context.session` arrives from there.
export const Route = createFileRoute('/workspaces/$workspaceSlug/settings')({
  // The loader assembles the payload per actor: a segment the actor may not
  // read is never read, so it arrives as `null` rather than as data the
  // component has to remember to hide.
  loader: ({ params, context }) =>
    loadWorkspaceSettings({
      workspaceSlug: params.workspaceSlug,
      userId: context.session.user.id
    }),
  pendingComponent: RoutePending,
  component: WorkspaceSettingsRoute
})

/**
 * The route's thin wrapper: reads the params and loader data the router
 * resolved, and hands them to the page. Keeping the two apart is what lets the
 * page be rendered from a test with plain props — no route tree, no loader, and
 * no mocked router.
 */
function WorkspaceSettingsRoute() {
  const { workspaceSlug } = Route.useParams()
  const data = Route.useLoaderData()
  return <WorkspaceSettingsPage workspaceSlug={workspaceSlug} data={data} />
}

export function WorkspaceSettingsPage({
  workspaceSlug,
  data,
  ports
}: {
  readonly workspaceSlug: string
  readonly data: WorkspaceSettingsPayload
  /**
   * The server calls this page's children make, forwarded so a test supplies
   * them instead of replacing the ports they live in. Omitted everywhere but
   * a test, where each child falls back to its production default.
   */
  readonly ports?: {
    readonly signOut?: SignOut
    readonly renameWorkspace?: RenameWorkspace
    readonly deleteWorkspace?: DeleteWorkspace
  }
}) {
  const {
    viewer,
    workspaceName,
    apiTokenCount,
    webhookCount,
    unreadCount,
    invitations
  } = data
  // A `null` segment is the server's answer that this actor may not read it.
  const canInvite = viewerCan(viewer, { invitation: ['create'] })
  const canRename = viewerCan(viewer, { organization: ['update'] })
  const canDelete = viewerCan(viewer, { organization: ['delete'] })
  const canReadAuditLog = viewerCan(viewer, { auditLog: ['read'] })

  return (
    <WorkspaceShell
      workspaceSlug={workspaceSlug}
      {...(ports?.signOut === undefined ? {} : { signOut: ports.signOut })}
      title="Workspace settings"
      description="API tokens, members, and webhook configuration."
      unreadCount={unreadCount}
      canReadAuditLog={canReadAuditLog}
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Workspace</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5">
            {/* Rename and delete are gated per action, not per page: an admin
                may rename but never delete, a member sees neither. The server
                functions enforce the same statements. */}
            {canRename || canDelete ? (
              <WorkspaceGeneralSettings
                workspaceSlug={workspaceSlug}
                currentName={workspaceName}
                canRename={canRename}
                canDelete={canDelete}
                {...(ports === undefined
                  ? {}
                  : {
                      ports: {
                        rename: ports.renameWorkspace,
                        remove: ports.deleteWorkspace
                      }
                    })}
              />
            ) : (
              <p className="text-xs text-muted-foreground">
                Your role cannot change or delete the workspace.
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Operational settings</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5">
            {apiTokenCount === null ? null : (
              <div className="grid gap-2">
                <Label>API tokens</Label>
                <p className="text-sm text-muted-foreground">
                  {apiTokenCount} active workspace-scoped tokens. Creation and
                  revocation live on the{' '}
                  <Link
                    to="/workspaces/$workspaceSlug/api-tokens"
                    params={{ workspaceSlug }}
                    className="underline underline-offset-2"
                  >
                    API tokens page
                  </Link>
                  .
                </p>
              </div>
            )}
            {invitations === null ? null : (
              <div className="grid gap-2">
                <Label>Members</Label>
                <p className="text-sm text-muted-foreground">
                  Invite someone by email. They join once they open the link and accept
                  — the invitation carries the role chosen here.
                </p>
                {canInvite ? (
                  <InvitationPanel
                    workspaceSlug={workspaceSlug}
                    invitations={invitations}
                  />
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Your role cannot invite members.
                  </p>
                )}
              </div>
            )}
            {webhookCount === null ? null : (
              <div className="grid gap-2">
                <Label>Outbound webhooks</Label>
                <p className="text-sm text-muted-foreground">
                  {webhookCount} endpoint
                  {webhookCount === 1 ? ' is' : 's are'} configured for selected
                  workspace events. Registration, delivery history, and secret rotation
                  live on the{' '}
                  <Link
                    to="/workspaces/$workspaceSlug/webhooks"
                    params={{ workspaceSlug }}
                    className="underline underline-offset-2"
                  >
                    Webhooks page
                  </Link>
                  .
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </WorkspaceShell>
  )
}
