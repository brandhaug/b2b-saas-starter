import { type NotificationKind } from '@b2b-saas-starter/capabilities/notifications/notification-kinds'
import { createFileRoute, Link } from '@tanstack/react-router'
import { NotificationPreferencesPanel } from '@/components/notification-preferences-panel'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { WorkspaceShell } from '@/components/workspace-shell'
import { requireSession } from '@/lib/server/auth'
import {
  isNotificationKind,
  loadNotificationPreferences
} from '@/lib/server/notification-preferences'
import { pickOptionalStrings } from '@/lib/utils'

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
  loader: ({ context }) =>
    loadNotificationPreferences({ userId: context.session.user.id }),
  component: AccountNotificationsRoute,
  head: () => ({ meta: [{ title: 'Notification preferences | B2B SaaS Starter' }] })
})

function AccountNotificationsRoute() {
  const { session } = Route.useRouteContext()
  const { preferences } = Route.useLoaderData()
  const { kind } = Route.useSearch()
  let highlightKind: NotificationKind | undefined
  if (isNotificationKind(kind)) {
    highlightKind = kind
  }
  const highlighted = preferences.find((row) => row.kind === highlightKind)
  return (
    <WorkspaceShell
      viewer={null}
      systemRole={session.user.role}
      title="Notification preferences"
      description="Choose how each kind of notification reaches you by email."
      workspaceSlug={null}
    >
      <div className="mx-auto grid max-w-2xl gap-6">
        {highlighted === undefined ? null : (
          <Alert>
            <AlertDescription>
              You followed the link from a &ldquo;{highlighted.label}&rdquo; email. Pick
              &ldquo;Off&rdquo; below to stop those emails, or choose the daily digest.
            </AlertDescription>
          </Alert>
        )}
        <Card>
          <CardHeader>
            <CardTitle as="h2">Email notifications</CardTitle>
            <p className="text-sm text-muted-foreground">
              Signed in as {session.user.email}. Changes apply immediately.{' '}
              <Link to="/account" className="underline">
                Back to account
              </Link>
              .
            </p>
          </CardHeader>
          <CardContent>
            <NotificationPreferencesPanel
              preferences={preferences}
              highlightKind={highlightKind}
            />
          </CardContent>
        </Card>
      </div>
    </WorkspaceShell>
  )
}
