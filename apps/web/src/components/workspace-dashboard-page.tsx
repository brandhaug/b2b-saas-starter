import { type ReactNode } from 'react'
import { AttentionFeed } from '@/components/attention-feed'
import {
  LiveNotifications,
  type ListNotifications,
  type MarkNotificationsRead
} from '@/components/live-notifications'
import {
  OnboardingChecklist,
  type DismissOnboardingChecklist
} from '@/components/onboarding-checklist'
import { attentionItems } from '@/lib/attention'
import { PageHeader } from '@/components/page/page-header'
import { WorkspaceShell } from '@/components/workspace-shell'
import { type WorkspaceDashboardPayload } from '@/lib/server/workspace-dashboard'
import { m } from '@b2b-saas-starter/i18n/messages'

/**
 * The workspace overview page. Lives beside the route file (not in it) so the
 * route module stays a thin shell the router's code splitting can reduce to
 * `createFileRoute` + lazy segments — an exported page in a route file pins
 * its whole import graph into the route tree every page preloads.
 *
 * Takes its payload as props so a test renders it without a route tree.
 */
export function WorkspaceDashboardPage({
  data,
  systemRole,
  ports,
  dismissalHint
}: {
  readonly data: WorkspaceDashboardPayload
  /** The signed-in user's Better Auth system role, for the shell's admin link. */
  readonly systemRole?: string | null
  /**
   * Null on the read-only demo, where no dismiss control exists for the
   * checklist's member note to point at.
   */
  readonly dismissalHint?: ReactNode
  /** The server calls this page's children make, forwarded for tests. */
  readonly ports?: {
    readonly listNotifications?: ListNotifications
    readonly markNotificationsRead?: MarkNotificationsRead
    readonly dismissOnboardingChecklist?: DismissOnboardingChecklist
  }
}) {
  const { workspace, notifications, webhooks, unreadCount, viewer, progress } = data

  return (
    <WorkspaceShell
      workspaceSlug={workspace.slug}
      systemRole={systemRole}
      unreadCount={unreadCount}
      viewer={viewer}
    >
      <PageHeader
        title={workspace.name}
        description={m.dashboard_attention_description()}
      />
      <AttentionFeed
        workspaceSlug={workspace.slug}
        items={attentionItems({
          invitations: data.invitations,
          apiTokens: data.apiTokens,
          webhooks,
          auditEvents: null
        })}
      />
      <LiveNotifications
        workspaceSlug={workspace.slug}
        fallback={notifications}
        {...(ports?.listNotifications === undefined
          ? {}
          : { listNotifications: ports.listNotifications })}
        {...(ports?.markNotificationsRead === undefined
          ? {}
          : { markRead: ports.markNotificationsRead })}
      />
      {/* Derived from live state on every load; renders nothing once an
          owner or admin dismissed it for the workspace. */}
      <OnboardingChecklist
        workspaceSlug={workspace.slug}
        progress={progress}
        viewer={viewer}
        dismissalHint={dismissalHint}
        {...(ports?.dismissOnboardingChecklist === undefined
          ? {}
          : { dismiss: ports.dismissOnboardingChecklist })}
      />
    </WorkspaceShell>
  )
}
