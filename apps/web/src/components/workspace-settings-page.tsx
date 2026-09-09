import { SectionTabs } from '@/components/page/section-tabs'
import { PageHeader } from '@/components/page/page-header'
import { Panel } from '@/components/page/panel'
import { WorkspaceCrumb } from '@/components/page/workspace-crumb'
import { SsoPanel } from '@/components/sso-panel'
import { WorkspaceShell } from '@/components/workspace-shell'
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
import { m } from '@b2b-saas-starter/i18n/messages'

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
      unreadCount={unreadCount}
      viewer={viewer}
    >
      <PageHeader
        breadcrumb={<WorkspaceCrumb workspaceSlug={workspaceSlug} />}
        title={m.workspace_settings()}
        description={m.workspace_settings_description()}
      />
      <SectionTabs
        defaultValue="general"
        sections={[
          {
            value: 'general',
            label: m.nav_general(),
            content: (
              <Panel title={m.nav_general()}>
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
                    {m.workspace_manage_denied()}
                  </p>
                )}
              </Panel>
            )
          },
          ...(ssoConnections === null
            ? []
            : [
                {
                  value: 'sso',
                  label: m.sso_title(),
                  content: (
                    <Panel title={m.sso_title()}>
                      <div className="grid gap-3">
                        <p className="text-sm text-muted-foreground">
                          {m.sso_description()}
                        </p>
                        <SsoPanel
                          workspaceSlug={workspaceSlug}
                          connections={ssoConnections}
                          viewer={viewer}
                        />
                      </div>
                    </Panel>
                  )
                }
              ]),
          ...(exports === null
            ? []
            : [
                {
                  value: 'exports',
                  label: m.data_export(),
                  content: (
                    <Panel title={m.data_export()}>
                      <WorkspaceExportPanel
                        workspaceSlug={workspaceSlug}
                        segment={exports}
                        {...(ports?.requestExport === undefined
                          ? {}
                          : { requestExport: ports.requestExport })}
                      />
                    </Panel>
                  )
                }
              ])
        ]}
      />
    </WorkspaceShell>
  )
}
