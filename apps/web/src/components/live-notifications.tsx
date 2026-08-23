import { type Notification as CapabilityNotification } from '@b2b-saas-starter/capabilities/src/notifications/notification-feed.ts'
import { useQuery } from '@tanstack/react-query'
import { BellIcon, RefreshCwIcon } from 'lucide-react'
import { causeMessage } from '@/lib/cause-message'
import {
  listNotificationsServerFn,
  notificationsQueryKey
} from '@/lib/server/notifications'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const REFRESH_FAILED = 'Could not refresh notifications.'

export type NotificationPreview = Pick<
  CapabilityNotification,
  'id' | 'title' | 'message' | 'read'
>

/**
 * The one server call this card makes, as a port. Injected rather than imported
 * at the call site so a test drives the card with a real function of this shape
 * instead of replacing the module it lives in.
 */
export type ListNotifications = (input: {
  readonly data: { readonly workspaceSlug: string }
}) => Promise<readonly NotificationPreview[]>

export function LiveNotifications({
  workspaceSlug,
  fallback,
  listNotifications = listNotificationsServerFn
}: {
  readonly workspaceSlug: string
  readonly fallback: readonly NotificationPreview[]
  readonly listNotifications?: ListNotifications
}) {
  const { data, error, isFetching, refetch } = useQuery({
    queryKey: notificationsQueryKey(workspaceSlug),
    queryFn: () => listNotifications({ data: { workspaceSlug } }),
    initialData: fallback
  })

  // `initialData` makes the query's data non-nullable — the fallback is the
  // first render's value, so there is no undefined state to guard.
  const notifications = data

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <BellIcon className="size-4" />
          Notifications
        </CardTitle>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            // The query surfaces refetch failures through `error` below.
            void refetch()
          }}
          disabled={isFetching}
          aria-label="Refresh notifications"
        >
          <RefreshCwIcon className="size-4" />
        </Button>
      </CardHeader>
      <CardContent className="grid gap-3">
        {error ? (
          <p className="text-xs text-destructive" role="alert">
            {causeMessage(error, REFRESH_FAILED)}
          </p>
        ) : null}
        {notifications.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-4 text-center">
            <p className="text-sm text-muted-foreground">
              You're all caught up: no notifications yet.
            </p>
          </div>
        ) : null}
        {notifications.map((notification) => (
          <div key={notification.id} className="rounded-md border border-border p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium">{notification.title}</p>
              {!notification.read && <Badge>New</Badge>}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{notification.message}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
