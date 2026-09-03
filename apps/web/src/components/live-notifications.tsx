import { type Notification as CapabilityNotification } from '@b2b-saas-starter/capabilities/notifications/notification-feed'
import { useQuery } from '@tanstack/react-query'
import { BellIcon, RefreshCwIcon } from 'lucide-react'
import { causeMessage } from '@/lib/cause-message'
import {
  listNotificationsServerFn,
  markNotificationsReadServerFn,
  notificationsQueryKey
} from '@/lib/server/notifications'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Panel } from '@/components/page/panel'
import { ActionFeedback } from '@/components/page/action-feedback'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@/components/ui/empty'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle
} from '@/components/ui/item'
import { Spinner } from '@/components/ui/spinner'
import { useServerAction } from '@/hooks/use-server-action'

const REFRESH_FAILED = 'Could not refresh notifications.'
const MARK_READ_FAILED = 'Could not mark the notification read.'

export type NotificationPreview = Pick<
  CapabilityNotification,
  'id' | 'title' | 'message' | 'read'
>

/**
 * The two server calls this panel makes, as ports. Injected rather than
 * imported at the call site so a test drives the panel with real functions of
 * these shapes instead of replacing the modules they live in.
 */
export type ListNotifications = (input: {
  readonly data: { readonly workspaceSlug: string }
}) => Promise<ReadonlyArray<NotificationPreview>>

export type MarkNotificationsRead = (input: {
  readonly data: { readonly workspaceSlug: string; readonly ids: ReadonlyArray<string> }
}) => Promise<number>

export function LiveNotifications({
  workspaceSlug,
  fallback,
  listNotifications = listNotificationsServerFn,
  markRead = markNotificationsReadServerFn
}: {
  readonly workspaceSlug: string
  readonly fallback: ReadonlyArray<NotificationPreview>
  readonly listNotifications?: ListNotifications
  readonly markRead?: MarkNotificationsRead
}) {
  const { data, error, isFetching, refetch } = useQuery({
    queryKey: notificationsQueryKey(workspaceSlug),
    queryFn: () => listNotifications({ data: { workspaceSlug } }),
    initialData: fallback
  })

  // The unread ids of the loaded list, in one pass — marking read re-runs the
  // same query, so the loader owns the state and there is none to mirror.
  const unread: Array<string> = []
  for (const notification of data) {
    if (!notification.read) {
      unread.push(notification.id)
    }
  }

  const mark = useServerAction(
    (ids: ReadonlyArray<string>) => markRead({ data: { workspaceSlug, ids } }),
    {
      failureMessage: MARK_READ_FAILED,
      // Default invalidation on purpose: the unread count lives in two
      // places — this query and the loader payload that badges the header and
      // feeds the attention list. The refetch updates the panel immediately;
      // `router.invalidate()` refreshes the loader's count so the badge never
      // disagrees with the panel.
      onSuccess: () => {
        void refetch()
      }
    }
  )

  return (
    <Panel
      title="Notifications"
      actions={
        <>
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
          {unread.length === 0 ? null : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={mark.pending}
              onClick={() => mark.run(unread)}
            >
              {mark.pending ? <Spinner data-icon="inline-start" /> : null}
              Mark all read
              <span className="sr-only">
                {' '}
                ({unread.length} unread notification
                {unread.length === 1 ? '' : 's'})
              </span>
            </Button>
          )}
        </>
      }
      footer={
        <>
          {error ? (
            <ActionFeedback error={causeMessage(error, REFRESH_FAILED)} />
          ) : null}
          <ActionFeedback error={mark.error} />
        </>
      }
    >
      {data.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BellIcon />
            </EmptyMedia>
            <EmptyTitle>You're all caught up</EmptyTitle>
            <EmptyDescription>No notifications yet.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ItemGroup>
          {data.map((notification) => (
            <Item key={notification.id} variant="outline" size="sm">
              <ItemContent>
                <ItemTitle>{notification.title}</ItemTitle>
                <ItemDescription>{notification.message}</ItemDescription>
              </ItemContent>
              <ItemActions>
                {notification.read ? (
                  <Badge variant="neutral">Read</Badge>
                ) : (
                  <>
                    <Badge variant="info">New</Badge>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={mark.pending}
                      onClick={() => mark.run([notification.id])}
                      aria-label={`Mark read: ${notification.title}`}
                    >
                      Mark read
                    </Button>
                  </>
                )}
              </ItemActions>
            </Item>
          ))}
        </ItemGroup>
      )}
    </Panel>
  )
}
