import { type NotificationKind } from '@b2b-saas-starter/capabilities/notifications/notification-kinds'
import { createFileRoute, Link } from '@tanstack/react-router'
import { NotificationPreferencesPanel } from '@/components/notification-preferences-panel'
import { EmailDeliveryPanel } from '@/components/email-delivery-panel'
import { OwnEmailResend } from '@/components/own-email-resend'
import { loadOwnEmailDeliveryServerFn } from '@/lib/server/email-delivery'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { PageHeader } from '@/components/page/page-header'
import { Panel } from '@/components/page/panel'
import { pageTitle } from '@/components/page/page-title'
import { WorkspaceShell } from '@/components/workspace-shell'
import { requireSession } from '@/lib/server/auth'
import { getTurnstileSiteKey } from '@/lib/server/turnstile'
import {
  isNotificationKind,
  loadNotificationPreferencesServerFn
} from '@/lib/server/notification-preferences'
import { pickOptionalStrings } from '@/lib/utils'
import { m } from '@b2b-saas-starter/i18n/messages'

/**
 * Where every notification email's unsubscribe link lands. A signed-in page,
 * not a one-click endpoint: the link carries only `?kind=`, so a forwarded or
 * leaked email cannot change anybody's preference. The route is flat
 * (`account_.notifications`) rather than nested under `/account`, whose
 * component has no `<Outlet />` and would swallow a child.
 */
export const Route = createFileRoute('/account_/notifications')({
  validateSearch: (search) => pickOptionalStrings(search, ['kind']),
  beforeLoad: async ({ location }) => {
    const session = await requireSession(location.href)
    return { session }
  },
  loader: async () => {
    // oxlint-disable-next-line effect/noNewPromise -- parallel client-safe server-fn calls; importing Effect here would ship its runtime
    const [preferences, deliveries, turnstileSiteKey] = await Promise.all([
      loadNotificationPreferencesServerFn(),
      loadOwnEmailDeliveryServerFn(),
      // Env-gated server-only read: `null` renders no widget and sends no
      // token, so the resend buttons work provider-light.
      getTurnstileSiteKey()
    ])
    return { ...preferences, deliveries, turnstileSiteKey }
  },
  component: AccountNotificationsRoute,
  head: () => ({ meta: [{ title: pageTitle(m.notification_preferences()) }] })
})

function AccountNotificationsRoute() {
  const { session } = Route.useRouteContext()
  const { preferences, deliveries, turnstileSiteKey } = Route.useLoaderData()
  const { kind } = Route.useSearch()
  let highlightKind: NotificationKind | undefined
  if (isNotificationKind(kind)) {
    highlightKind = kind
  }
  const highlighted = preferences.find((row) => row.kind === highlightKind)
  return (
    <WorkspaceShell viewer={null} systemRole={session.user.role} workspaceSlug={null}>
      <PageHeader
        title={m.notification_preferences()}
        description={m.notification_preferences_description()}
      />
      {highlighted === undefined ? null : (
        <Alert>
          <AlertDescription>
            {m.notification_email_link_notice({ label: highlighted.label })}
          </AlertDescription>
        </Alert>
      )}
      <Panel
        title={m.panel_email_notifications()}
        footer={
          <p className="text-sm text-muted-foreground">
            {m.signed_in_as({ email: session.user.email })}{' '}
            <Link to="/account" className="underline">
              {m.back_to_account()}
            </Link>
            .
          </p>
        }
      >
        <NotificationPreferencesPanel
          preferences={preferences}
          highlightKind={highlightKind}
        />
      </Panel>
      <EmailDeliveryPanel records={deliveries} />
      <OwnEmailResend
        email={session.user.email}
        verified={session.user.emailVerified}
        turnstileSiteKey={turnstileSiteKey}
      />
    </WorkspaceShell>
  )
}
