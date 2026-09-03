import { createFileRoute } from '@tanstack/react-router'
import { NotificationPreferencesPanel } from '@/components/notification-preferences-panel'
import { TwoFactorPanel } from '@/components/two-factor-panel'
import { McpClientsPanel } from '@/components/mcp-clients-panel'
import { PasskeysPanel } from '@/components/passkeys-panel'
import { SessionsPanel } from '@/components/sessions-panel'
import { LinkedAccountsPanel } from '@/components/linked-accounts-panel'
import { PageHeader } from '@/components/page/page-header'
import { pageTitle } from '@/components/page/page-title'
import { Panel } from '@/components/page/panel'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { WorkspaceShell } from '@/components/workspace-shell'
import { authClient } from '@/lib/auth-client'
import { requireSession } from '@/lib/server/auth'
import { loadNotificationPreferences } from '@/lib/server/notification-preferences'
import {
  loadMcpClientConnections,
  revokeMcpClientServerFn
} from '@/lib/server/mcp-clients'

// Account settings live outside the /workspaces subtree on purpose: they are
// user-level, not workspace-level, so the route keeps its own session gate
// (same reasoning as /invitations/accept). There is no workspace to resolve —
// and nothing to be a member of.
export const Route = createFileRoute('/account')({
  beforeLoad: async ({ location }) => {
    const session = await requireSession(location.href)
    return { session }
  },
  // Two account-level reads — the user's own notification preferences and
  // the MCP clients connected to this account (ADR 0055) — both
  // identity-keyed, no workspace involved.
  loader: ({ context }) =>
    Promise.all([
      loadNotificationPreferences({ userId: context.session.user.id }),
      loadMcpClientConnections({ userId: context.session.user.id })
    ]).then(([preferences, connections]) => ({ preferences, connections })),
  component: AccountRoute,
  head: () => ({ meta: [{ title: pageTitle('Account') }] })
})

function AccountRoute() {
  const { session } = Route.useRouteContext()
  const { preferences, connections } = Route.useLoaderData()
  // The current session token never rides the SSR payload (see `RouteSession`
  // in lib/server/auth.ts) — the panel reads it from the client session hook.
  const currentSession = authClient.useSession()
  return (
    <WorkspaceShell viewer={null} systemRole={session.user.role} workspaceSlug={null}>
      <PageHeader
        title="Account"
        description="Sign-in security for your account, not any one workspace."
      />
      <Panel
        title="Sign-in methods"
        description="Every way this account can sign in. A provider can be unlinked once another method remains."
      >
        {/* Unlinking a provider while impersonating would change the user's
            sign-in surface from an admin session — same refusal stance as the
            two-factor panel below (ADR 0054). */}
        {session.impersonatedBy === null ? (
          <LinkedAccountsPanel />
        ) : (
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- on the page from first paint; an assertive alert would interrupt on load
          <Alert role="status">
            <AlertDescription>
              Sign-in methods cannot be changed while impersonating this user.
            </AlertDescription>
          </Alert>
        )}
      </Panel>

      <Panel
        title="Two-factor authentication"
        description="Require a time-based one-time code from an authenticator app at every sign-in."
      >
        {/* Hidden, not merely disabled, for an impersonation session (ADR
            0054): the catchall refuses the endpoints anyway, so a control
            that always fails would only teach the admin to ignore errors. */}
        {session.impersonatedBy === null ? (
          <TwoFactorPanel twoFactorEnabled={session.user.twoFactorEnabled} />
        ) : (
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- on the page from first paint; an assertive alert would interrupt on load
          <Alert role="status">
            <AlertDescription>
              Two-factor settings cannot be changed while impersonating this user.
            </AlertDescription>
          </Alert>
        )}
      </Panel>

      <Panel
        title="Passkeys"
        description="Sign-in credentials bound to this account: a fingerprint, face, PIN, or security key. A passkey sign-in counts as two-factor, so no code is asked for."
      >
        {/* Hidden, not merely disabled, for an impersonation session: the
            catchall refuses the endpoints anyway (ADR 0056), so a control
            that always fails would only teach the admin to ignore errors. */}
        {session.impersonatedBy === null ? (
          <PasskeysPanel />
        ) : (
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- on the page from first paint; an assertive alert would interrupt on load
          <Alert role="status">
            <AlertDescription>
              Passkeys cannot be changed while impersonating this user.
            </AlertDescription>
          </Alert>
        )}
      </Panel>

      <SessionsPanel currentSessionToken={currentSession.data?.session.token ?? ''} />

      <Panel
        title="Email notifications"
        description="How each kind of notification reaches you by email: not at all, one email per event, or the daily digest. Security kinds default to instant."
      >
        <NotificationPreferencesPanel preferences={preferences} />
      </Panel>

      <Panel
        title="MCP clients"
        description="AI clients you connected through OAuth. Each one reaches exactly one workspace, with what your role there allows."
      >
        <McpClientsPanel
          connections={connections}
          revoke={revokeMcpClientServerFn}
        />
      </Panel>
    </WorkspaceShell>
  )
}
