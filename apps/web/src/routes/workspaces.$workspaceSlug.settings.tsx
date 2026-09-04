import { createFileRoute } from '@tanstack/react-router'
import { PageHeader } from '@/components/page/page-header'
import { pageTitle } from '@/components/page/page-title'
import { Panel } from '@/components/page/panel'
import { WorkspaceCrumb } from '@/components/page/workspace-crumb'
import { RoutePending } from '@/components/route-pending'
import { SsoPanel } from '@/components/sso-panel'
import { WorkspaceShell, type SignOut } from '@/components/workspace-shell'
import {
  WorkspaceGeneralSettings,
  type DeleteWorkspace,
  type RenameWorkspace
} from '@/components/workspace-general-settings'
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
  component: WorkspaceSettingsRoute,
  head: ({ params }) => ({
    meta: [{ title: pageTitle('Settings', params.workspaceSlug) }]
  })
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
  const systemRole = Route.useRouteContext().session.user.role
  return (
    <WorkspaceSettingsPage
      workspaceSlug={workspaceSlug}
      data={data}
      systemRole={systemRole}
    />
  )
}

export function WorkspaceSettingsPage({
  workspaceSlug,
  data,
  systemRole,
  ports
}: {
  readonly workspaceSlug: string
  readonly data: WorkspaceSettingsPayload
  /** The signed-in user's Better Auth system role, for the shell's admin link. */
  readonly systemRole?: string | null
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
  const { viewer, workspaceName, unreadCount, ssoConnections } = data
  // Rename and delete are gated per action, not per page: an admin may rename
  // but never delete, a member sees neither. The server functions enforce the
  // same statements.
  const canRename = viewerCan(viewer, { organization: ['update'] })
  const canDelete = viewerCan(viewer, { organization: ['delete'] })

  return (
    <WorkspaceShell
      workspaceSlug={workspaceSlug}
      systemRole={systemRole}
      {...(ports?.signOut === undefined ? {} : { signOut: ports.signOut })}
      unreadCount={unreadCount}
      viewer={viewer}
    >
      <PageHeader
        breadcrumb={<WorkspaceCrumb workspaceSlug={workspaceSlug} />}
        title="Workspace settings"
        description="The workspace's name, and the decision to end it."
      />
      {/* Rename and delete are gated per action, not per page: an admin may
          rename but never delete, a member sees neither. The server functions
          enforce the same statements. */}
      <Panel title="General">
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
      </Panel>
      {/* Single sign-on (ADR 0055): the segment is absent for an actor
          without sso:list, and the panel degrades each control per statement
          (sso:create/update/remove) against the payload's viewer. */}
      {ssoConnections === null ? null : (
        <Panel title="Single sign-on">
          <div className="grid gap-3">
            <p className="text-sm text-muted-foreground">
              Route one email domain to your identity provider. Sign-ins at that domain
              go to the IdP once the connection is enabled; a first SSO sign-in creates
              the member with the connection&apos;s default role.
            </p>
            <SsoPanel
              workspaceSlug={workspaceSlug}
              connections={ssoConnections}
              viewer={viewer}
            />
          </div>
        </Panel>
      )}
    </WorkspaceShell>
  )
}
