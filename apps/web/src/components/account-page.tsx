import { LocalePreferences } from '@/components/locale-preferences'
import { type ReactNode } from 'react'
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
import { m } from '@b2b-saas-starter/i18n/messages'

/** Module-level so the `connections` default keeps a stable reference. */
const NO_CONNECTIONS: ReadonlyArray<McpClientConnection> = []

/**
 * The account page. Lives beside the route file (not in it) so the route
 * module stays a thin shell the router's code splitting can reduce to
 * `createFileRoute` + lazy segments — an exported page in a route file pins
 * its whole import graph into the route tree every page preloads.
 *
 * Rendered by the route test with the real loader payload
 * (`loadAccountPageHandler` against the Seed layer). The panels call the
 * Better Auth client directly, so their endpoints are driven by mocking
 * `@/lib/auth-client` where a test needs them. The preferences panel
 * renders only when the loader supplied preferences, so a test asserting the
 * deletion flow need not stub the preference kinds.
 */
export function AccountPage({
  session,
  deletionPlan,
  preferences,
  connections = NO_CONNECTIONS,
  currentSessionToken
}: {
  readonly session: RouteSession
  readonly deletionPlan: AccountDeletionPlan
  readonly preferences?: ReadonlyArray<NotificationPreferenceRow>
  readonly connections?: ReadonlyArray<McpClientConnection>
  readonly currentSessionToken: string
}) {
  return (
    <WorkspaceShell viewer={null} systemRole={session.user.role} workspaceSlug={null}>
      <PageHeader title={m.page_account()} description={m.page_account_description()} />
      <Panel
        title={m.panel_sign_in_methods()}
        description={m.panel_sign_in_methods_description()}
      >
        {/* Unlinking a provider while impersonating would change the user's
            sign-in surface from an admin session — same refusal stance as the
            two-factor panel below (ADR 0054). */}
        <WhileNotImpersonating
          impersonatedBy={session.impersonatedBy}
          message={m.shell_impersonated_sign_in()}
        >
          <LinkedAccountsPanel />
        </WhileNotImpersonating>
      </Panel>

      <Panel
        title={m.panel_two_factor()}
        description={m.panel_two_factor_description()}
      >
        {/* Hidden, not merely disabled, for an impersonation session (ADR
            0054): the catchall refuses the endpoints anyway, so a control
            that always fails would only teach the admin to ignore errors. */}
        <WhileNotImpersonating
          impersonatedBy={session.impersonatedBy}
          message={m.shell_impersonated_two_factor()}
        >
          <TwoFactorPanel twoFactorEnabled={session.user.twoFactorEnabled} />
        </WhileNotImpersonating>
      </Panel>

      <Panel title={m.panel_passkeys()} description={m.panel_passkeys_description()}>
        {/* Hidden, not merely disabled, for an impersonation session: the
            catchall refuses the endpoints anyway (ADR 0056), so a control
            that always fails would only teach the admin to ignore errors. */}
        <WhileNotImpersonating
          impersonatedBy={session.impersonatedBy}
          message={m.shell_impersonated_passkeys()}
        >
          <PasskeysPanel />
        </WhileNotImpersonating>
      </Panel>

      <LocalePreferences />
      <SessionsPanel currentSessionToken={currentSessionToken} />

      {preferences === undefined ? null : (
        <Panel
          title={m.panel_email_notifications()}
          description={m.panel_email_notifications_description()}
        >
          <NotificationPreferencesPanel preferences={preferences} />
        </Panel>
      )}

      <Panel
        title={m.panel_delete_account()}
        description={m.panel_delete_account_description()}
      >
        {/* Hidden, not merely disabled, for an impersonation session (ADR
            0059): the catchall refuses the endpoint anyway, so a control
            that always fails would only teach the admin to ignore errors. */}
        <WhileNotImpersonating
          impersonatedBy={session.impersonatedBy}
          message={m.shell_impersonated_deletion()}
        >
          <DeleteAccountPanel plan={deletionPlan} />
        </WhileNotImpersonating>
      </Panel>

      <Panel
        title={m.panel_mcp_clients()}
        description={m.panel_mcp_clients_description()}
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
  message,
  children
}: {
  readonly impersonatedBy: string | null
  readonly message: string
  readonly children: ReactNode
}) {
  if (impersonatedBy === null) {
    return <>{children}</>
  }
  return (
    // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- on the page from first paint; an assertive alert would interrupt on load
    <Alert role="status">
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  )
}
