import { useQuery } from '@tanstack/react-query'
import { BellIcon, RefreshCwIcon } from 'lucide-react'
import type { Notification as CapabilityNotification } from '@b2b-saas-starter/capabilities'
import {
  listNotificationsServerFn,
  notificationsQueryKey
} from '@/lib/server/notifications'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export type NotificationPreview = Pick<
  CapabilityNotification,
  'id' | 'title' | 'message' | 'read'
>

export function LiveNotifications({
  workspaceSlug,
  fallback
}: {
  readonly workspaceSlug: string
  readonly fallback: readonly NotificationPreview[]
}) {
  const { data, error, isFetching, refetch } = useQuery({
    queryKey: notificationsQueryKey(workspaceSlug),
    queryFn: () => listNotificationsServerFn({ data: { workspaceSlug } }),
    initialData: fallback
  })

  const notifications = data ?? fallback

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2">
          <BellIcon className="size-4" />
          Notifications
        </CardTitle>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          aria-label="Refresh notifications"
        >
          <RefreshCwIcon className="size-4" />
        </Button>
      </CardHeader>
      <CardContent className="grid gap-3">
        {error ? (
          <p className="text-xs text-destructive" role="alert">
            {error instanceof Error
              ? error.message
              : 'Could not refresh notifications.'}
          </p>
        ) : null}
        {notifications.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-4 text-center">
            <p className="text-sm text-muted-foreground">
              You're all caught up — no notifications yet.
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
