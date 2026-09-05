import { PageHeader } from '@/components/page/page-header'
import { Panel } from '@/components/page/panel'
import { WorkspaceCrumb } from '@/components/page/workspace-crumb'
import { SsoPanel } from '@/components/sso-panel'
import { WorkspaceShell, type SignOut } from '@/components/workspace-shell'
import {
  WorkspaceGeneralSettings,
  type DeleteWorkspace,
  type RenameWorkspace
} from '@/components/workspace-general-settings'
import {
  WorkspaceExportPanel,
  type RequestWorkspaceExport
} from '@/components/workspace-export-panel'
import { viewerCan } from '@/lib/permissions'
import { type WorkspaceSettingsPayload } from '@/lib/server/workspace-settings'

/**
 * The workspace settings page. Lives beside the route file (not in it) so the
 * route module stays a thin shell the router's code splitting can reduce to
 * `createFileRoute` + lazy segments — an exported page in a route file pins
 * its whole import graph into the route tree every page preloads.
 *
 * Takes its params and payload as props so a test renders it without a route
 * tree and no mocked router.
 */
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
    readonly requestExport?: RequestWorkspaceExport
  }
}) {
  const { viewer, workspaceName, unreadCount, ssoConnections, exports } = data
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
      {/* Single sign-on (ADR 0069): the segment is absent for an actor
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
      {/* Owner-only: the loader hands the segment to nobody else, so the whole
          panel is absent for admins and members rather than disabled. When the
          deployment has no export bucket, the panel explains that instead of
          offering a button that would fail. */}
      {exports === null ? null : (
        <Panel title="Data export">
          <WorkspaceExportPanel
            workspaceSlug={workspaceSlug}
            segment={exports}
            {...(ports?.requestExport === undefined
              ? {}
              : { requestExport: ports.requestExport })}
          />
        </Panel>
      )}
    </WorkspaceShell>
  )
}
