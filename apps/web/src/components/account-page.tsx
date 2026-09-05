import { type ComponentProps, type ReactNode } from 'react'
import { DeleteAccountPanel } from '@/components/delete-account-panel'
import { NotificationPreferencesPanel } from '@/components/notification-preferences-panel'
import { TwoFactorPanel } from '@/components/two-factor-panel'
import { McpClientsPanel } from '@/components/mcp-clients-panel'
import { PasskeysPanel } from '@/components/passkeys-panel'
import { SessionsPanel } from '@/components/sessions-panel'
import { LinkedAccountsPanel } from '@/components/linked-accounts-panel'
import { PageHeader } from '@/components/page/page-header'
import { Panel } from '@/components/page/panel'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { WorkspaceShell } from '@/components/workspace-shell'
import { type McpClientConnection } from '@b2b-saas-starter/capabilities/developer-platform/mcp-client-connections'
import { type RouteSession } from '@/lib/server/auth'
import { type AccountDeletionPlan } from '@/lib/server/account'
import { type NotificationPreferenceRow } from '@/lib/server/notification-preferences'
import { revokeMcpClientServerFn } from '@/lib/server/mcp-clients'

/** Module-level so the `connections` default keeps a stable reference. */
const NO_CONNECTIONS: ReadonlyArray<McpClientConnection> = []

/**
 * The account page. Lives beside the route file (not in it) so the route
 * module stays a thin shell the router's code splitting can reduce to
 * `createFileRoute` + lazy segments — an exported page in a route file pins
 * its whole import graph into the route tree every page preloads.
 *
 * Rendered by the route test with the real loader payload
 * (`loadAccountPageData` against the Seed layer) and stub ports — the panels'
 * endpoints are browser-only, so the test supplies functions of the same
 * shape rather than re-creating Better Auth clients. The preferences panel
 * renders only when the loader supplied preferences, so a test asserting the
 * deletion flow need not stub the preference kinds.
 */
export function AccountPage({
  session,
  deletionPlan,
  preferences,
  connections = NO_CONNECTIONS,
  currentSessionToken,
  sessionsPorts
}: {
  readonly session: RouteSession
  readonly deletionPlan: AccountDeletionPlan
  readonly preferences?: ReadonlyArray<NotificationPreferenceRow>
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
        <WhileNotImpersonating
          impersonatedBy={session.impersonatedBy}
          what="Sign-in methods"
        >
          <LinkedAccountsPanel />
        </WhileNotImpersonating>
      </Panel>

      <Panel
        title="Two-factor authentication"
        description="Require a time-based one-time code from an authenticator app at every sign-in."
      >
        {/* Hidden, not merely disabled, for an impersonation session (ADR
            0054): the catchall refuses the endpoints anyway, so a control
            that always fails would only teach the admin to ignore errors. */}
        <WhileNotImpersonating
          impersonatedBy={session.impersonatedBy}
          what="Two-factor settings"
        >
          <TwoFactorPanel twoFactorEnabled={session.user.twoFactorEnabled} />
        </WhileNotImpersonating>
      </Panel>

      <Panel
        title="Passkeys"
        description="Sign-in credentials bound to this account: a fingerprint, face, PIN, or security key. A passkey sign-in counts as two-factor, so no code is asked for."
      >
        {/* Hidden, not merely disabled, for an impersonation session: the
            catchall refuses the endpoints anyway (ADR 0056), so a control
            that always fails would only teach the admin to ignore errors. */}
        <WhileNotImpersonating impersonatedBy={session.impersonatedBy} what="Passkeys">
          <PasskeysPanel />
        </WhileNotImpersonating>
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
        <WhileNotImpersonating
          impersonatedBy={session.impersonatedBy}
          what="The account"
          action="deleted"
        >
          <DeleteAccountPanel plan={deletionPlan} />
        </WhileNotImpersonating>
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

/**
 * Renders the panel's control only on a first-party session. An impersonating
 * admin gets a one-line reason instead (ADR 0054): the catchall refuses these
 * endpoints anyway, so a control that always fails would only teach the admin
 * to ignore errors.
 */
function WhileNotImpersonating({
  impersonatedBy,
  what,
  action = 'changed',
  children
}: {
  readonly impersonatedBy: string | null
  /** The noun phrase the reason sentence is built around. */
  readonly what: string
  /** The sentence's verb — settings are "changed", the account is "deleted". */
  readonly action?: string
  readonly children: ReactNode
}) {
  if (impersonatedBy === null) {
    return <>{children}</>
  }
  return (
    // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- on the page from first paint; an assertive alert would interrupt on load
    <Alert role="status">
      <AlertDescription>
        {`${what} cannot be ${action} while impersonating this user.`}
      </AlertDescription>
    </Alert>
  )
}
