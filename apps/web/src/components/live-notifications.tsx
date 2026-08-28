import { type Notification as CapabilityNotification } from '@b2b-saas-starter/capabilities/notifications/notification-feed'
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
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@/components/ui/empty'
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle
} from '@/components/ui/item'
import { Spinner } from '@/components/ui/spinner'

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
}) => Promise<ReadonlyArray<NotificationPreview>>

export function LiveNotifications({
  workspaceSlug,
  fallback,
  listNotifications = listNotificationsServerFn
}: {
  readonly workspaceSlug: string
  readonly fallback: ReadonlyArray<NotificationPreview>
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
        <CardTitle as="h2" className="flex items-center gap-2">
          <BellIcon data-icon="inline-start" />
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
          {isFetching ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <RefreshCwIcon data-icon="inline-start" />
          )}
        </Button>
      </CardHeader>
      <CardContent className="grid gap-3">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{causeMessage(error, REFRESH_FAILED)}</AlertDescription>
          </Alert>
        ) : null}
        {notifications.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <BellIcon />
              </EmptyMedia>
              <EmptyTitle>You're all caught up</EmptyTitle>
              <EmptyDescription>No notifications yet.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}
        <ItemGroup>
          {notifications.map((notification) => (
            <Item key={notification.id} variant="outline" size="sm">
              <ItemContent>
                <ItemTitle>{notification.title}</ItemTitle>
                <ItemDescription>{notification.message}</ItemDescription>
              </ItemContent>
              {!notification.read && <Badge>New</Badge>}
            </Item>
          ))}
        </ItemGroup>
      </CardContent>
    </Card>
  )
}
