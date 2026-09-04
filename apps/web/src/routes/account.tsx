import { createFileRoute } from '@tanstack/react-router'
import { type ComponentProps } from 'react'
import { DeleteAccountPanel } from '@/components/delete-account-panel'
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
import { type McpClientConnection } from '@b2b-saas-starter/capabilities/developer-platform/mcp-client-connections'
import { requireSession, type RouteSession } from '@/lib/server/auth'
import { loadAccountPage } from '@/lib/server/account.effects'
import { type AccountDeletionPlan } from '@/lib/server/account'
import {
  loadNotificationPreferences,
  type NotificationPreferencesPayload
} from '@/lib/server/notification-preferences'
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
  // Three identity-keyed reads: the user's own notification preferences, the
  // MCP clients connected to this account (ADR 0055), and what deleting the
  // account would do to each workspace (the account-lifecycle capability) —
  // no workspace involved; the panels render, the capabilities compute.
  loader: async ({ context }) => {
    const userId = context.session.user.id
    const [preferences, connections, account] = await Promise.all([
      loadNotificationPreferences({ userId }),
      loadMcpClientConnections({ userId }),
      loadAccountPage({ userId })
    ])
    return { preferences, connections, deletionPlan: account.deletionPlan }
  },
  component: AccountRoute,
  head: () => ({ meta: [{ title: pageTitle('Account') }] })
})

/**
 * Exported for the route test, which drives it with the real loader payload
 * (`loadAccountPage` against the Seed layer) and stub ports — the panels'
 * endpoints are browser-only, so the test supplies functions of the same
 * shape rather than re-creating Better Auth clients. The preferences panel
 * renders only when the loader supplied preferences, so a test asserting the
 * deletion flow need not stub the preference kinds.
 */
export function AccountPage({
  session,
  deletionPlan,
  preferences,
  connections = [],
  currentSessionToken,
  sessionsPorts
}: {
  readonly session: RouteSession
  readonly deletionPlan: AccountDeletionPlan
  readonly preferences?: NotificationPreferencesPayload
  readonly connections?: ReadonlyArray<McpClientConnection>
  readonly currentSessionToken: string
  readonly sessionsPorts?: {
    readonly listSessions: NonNullable<
      ComponentProps<typeof SessionsPanel>['listSessions']
    >
    readonly revokeSession: NonNullable<
      ComponentProps<typeof SessionsPanel>['revokeSession']
    >
    readonly revokeOtherSessions: NonNullable<
      ComponentProps<typeof SessionsPanel>['revokeOtherSessions']
    >
  }
}) {
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

      <SessionsPanel
        currentSessionToken={currentSessionToken}
        {...(sessionsPorts ?? {})}
      />

      {preferences === undefined ? null : (
        <Panel
          title="Email notifications"
          description="How each kind of notification reaches you by email: not at all, one email per event, or the daily digest. Security kinds default to instant."
        >
          <NotificationPreferencesPanel preferences={preferences} />
        </Panel>
      )}

      <Panel
        title="Delete account"
        description="Permanent, and confirmed with your password. Workspaces you are the only owner of must hand ownership to someone else first."
      >
        {/* Hidden, not merely disabled, for an impersonation session (ADR
            0059): the catchall refuses the endpoint anyway, so a control
            that always fails would only teach the admin to ignore errors. */}
        {session.impersonatedBy === null ? (
          <DeleteAccountPanel plan={deletionPlan} />
        ) : (
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- on the page from first paint; an assertive alert would interrupt on load
          <Alert role="status">
            <AlertDescription>
              The account cannot be deleted while impersonating this user.
            </AlertDescription>
          </Alert>
        )}
      </Panel>

      <Panel
        title="MCP clients"
        description="AI clients you connected through OAuth. Each one reaches exactly one workspace, with what your role there allows."
      >
        <McpClientsPanel connections={connections} revoke={revokeMcpClientServerFn} />
      </Panel>
    </WorkspaceShell>
  )
}

function AccountRoute() {
  const { session } = Route.useRouteContext()
  const { deletionPlan, preferences, connections } = Route.useLoaderData()
  // The current session token never rides the SSR payload (see `RouteSession`
  // in lib/server/auth.ts) — the panel reads it from the client session hook.
  const currentSession = authClient.useSession()
  return (
    <AccountPage
      session={session}
      deletionPlan={deletionPlan}
      preferences={preferences}
      connections={connections}
      currentSessionToken={currentSession.data?.session.token ?? ''}
    />
  )
}
