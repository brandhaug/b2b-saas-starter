import { createFileRoute } from '@tanstack/react-router'
import { ApiTokenForm, type CreateApiToken } from '@/components/api-token-form'
import { InvitationPanel } from '@/components/invitation-panel'
import { RoutePending } from '@/components/route-pending'
import { WorkspaceShell, type SignOut } from '@/components/workspace-shell'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
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
   * them instead of replacing the modules they live in. Omitted everywhere but
   * a test, where each child falls back to its production default.
   */
  readonly ports?: {
    readonly createToken?: CreateApiToken
    readonly signOut?: SignOut
  }
}) {
  const { viewer, modules, apiTokenCount, webhookCount, unreadCount, invitations } =
    data
  // A `null` segment is the server's answer that this actor may not read it.
  // The permission checks below decide the actions inside a section the actor
  // can see; both come from the one role table in `@b2b-saas-starter/authz`.
  const canUpdateModules = viewerCan(viewer, { module: ['update'] })
  const canCreateApiToken = viewerCan(viewer, { apiToken: ['create'] })
  const canInvite = viewerCan(viewer, { invitation: ['create'] })

  return (
    <WorkspaceShell
      workspaceSlug={workspaceSlug}
      {...(ports?.signOut === undefined ? {} : { signOut: ports.signOut })}
      title="Workspace settings"
      description="Module toggles, provider readiness, report schedule, API tokens, and webhook configuration."
      unreadCount={unreadCount}
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Module state</CardTitle>
            {canUpdateModules ? null : (
              <p className="text-xs text-muted-foreground">
                Your role cannot change module state.
              </p>
            )}
          </CardHeader>
          <CardContent className="grid gap-4">
            {modules.map((module) => (
              <div
                key={module.id}
                className="flex items-center justify-between gap-4 rounded-md border border-border p-3"
              >
                <div>
                  <p className="text-sm font-medium">{module.name}</p>
                  <p className="text-xs text-muted-foreground">{module.summary}</p>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant="secondary">{module.state.status}</Badge>
                  <Switch checked={module.state.enabled} disabled />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Operational settings</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5">
            <div className="grid gap-2">
              <Label>Report schedule</Label>
              <p className="text-sm text-muted-foreground">
                Weekly implementation report delivery through Cloudflare Email activates
                when email configuration exists.
              </p>
            </div>
            {apiTokenCount === null ? null : (
              <div className="grid gap-2">
                <Label>API tokens</Label>
                <p className="text-sm text-muted-foreground">
                  {apiTokenCount} workspace-scoped tokens are seeded. New tokens should
                  be hashed and audited.
                </p>
                {canCreateApiToken ? (
                  <ApiTokenForm
                    workspaceSlug={workspaceSlug}
                    {...(ports?.createToken === undefined
                      ? {}
                      : { createToken: ports.createToken })}
                  />
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Your role cannot mint tokens.
                  </p>
                )}
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
                  {webhookCount} endpoint is configured for selected workspace events.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </WorkspaceShell>
  )
}
