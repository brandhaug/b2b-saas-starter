import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  LiveNotifications,
  type ListNotifications,
  type MarkNotificationsRead,
  type NotificationPreview
} from './live-notifications'
import { renderWithRouter } from '@/test/router-harness'

// The card's own `listNotifications` port, handed in as a prop. A real function
// of the declared shape, so the module under test is the one that ships.
const listNotifications = vi.fn<ListNotifications>()
const markRead = vi.fn<MarkNotificationsRead>()

const fallback: ReadonlyArray<NotificationPreview> = [
  {
    id: 'n1',
    title: 'Webhook delivered',
    message: 'Delivery succeeded.',
    read: false,
    createdAt: '2026-09-04T09:12:00.000Z'
  },
  {
    id: 'n2',
    title: 'Catalog refreshed',
    message: 'Refresh completed.',
    read: true,
    createdAt: '2026-09-03T18:00:00.000Z'
  }
]

/** The same two rows, both unread — the shape “Mark all read” targets. */
const allUnread: ReadonlyArray<NotificationPreview> = [
  { ...fallback[0]!, read: false },
  { ...fallback[1]!, read: false }
]

function renderCard(cardFallback: ReadonlyArray<NotificationPreview>) {
  return renderWithRouter(
    <LiveNotifications
      workspaceSlug="starter-lab"
      fallback={cardFallback}
      listNotifications={listNotifications}
      markRead={markRead}
    />
  )
}

describe('LiveNotifications', () => {
  beforeEach(() => {
    listNotifications.mockReset()
    markRead.mockReset()
  })

  it('renders fallback notifications while a refresh is in flight', async () => {
    listNotifications.mockReturnValue(new Promise(() => {}))
    await renderCard(fallback)
    screen.getByText('Webhook delivered')
    screen.getByText('Catalog refreshed')
    // Only the unread notification gets the "New" badge.
    expect(screen.getAllByText('New')).toHaveLength(1)
  })

  it('filters read notifications without changing their read state', async () => {
    await renderCard(fallback)
    fireEvent.click(screen.getByRole('combobox', { name: 'Show notifications' }))
    fireEvent.keyDown(await screen.findByRole('option', { name: 'Unread only' }), {
      key: 'Enter'
    })
    expect(screen.getByText('Webhook delivered')).toBeTruthy()
    await waitFor(() => expect(screen.queryByText('Catalog refreshed')).toBeNull())
    fireEvent.click(screen.getByRole('combobox', { name: 'Show notifications' }))
    fireEvent.keyDown(
      await screen.findByRole('option', { name: 'All notifications' }),
      { key: 'Enter' }
    )
    expect(await screen.findByText('Catalog refreshed')).toBeTruthy()
    expect(markRead).not.toHaveBeenCalled()
  })

  it('renders each row’s timestamp in UTC', async () => {
    listNotifications.mockReturnValue(new Promise(() => {}))
    await renderCard(fallback)
    // The mono UTC convention the tables use, on the feed’s rows too.
    expect(screen.getAllByText(/UTC/)).toHaveLength(2)
    screen.getByText(/Sep 4, 2026, 9:12 AM UTC/)
    screen.getByText(/Sep 3, 2026, 6:00 PM UTC/)
  })

  it('shows the caught-up empty state when there are no notifications', async () => {
    listNotifications.mockReturnValue(new Promise(() => {}))
    await renderCard([])
    screen.getByText(/all caught up/)
  })

  it('renders the loader payload without a refetch on mount', async () => {
    listNotifications.mockResolvedValue([])
    await renderCard(fallback)
    // The loader already fetched this list, so the panel is not allowed to
    // ask the server for it again the moment it mounts.
    expect(listNotifications).not.toHaveBeenCalled()
    screen.getByText('Webhook delivered')
  })

  it('fetches notifications for the workspace and renders the server data', async () => {
    listNotifications.mockResolvedValue([
      {
        id: 'n3',
        title: 'New module ready',
        message: 'Email is configured.',
        read: false,
        createdAt: '2026-09-04T10:00:00.000Z'
      }
    ])
    await renderCard(fallback)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh notifications' }))
    await screen.findByText('New module ready')
    expect(listNotifications).toHaveBeenCalledWith({
      data: { workspaceSlug: 'starter-lab' }
    })
    expect(screen.queryByText('Webhook delivered')).toBeNull()
  })

  it('keeps the fallback visible and shows an alert when the refresh fails', async () => {
    listNotifications.mockRejectedValue(new Error('Session expired'))
    await renderCard(fallback)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh notifications' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Could not refresh notifications.')
    screen.getByText('Webhook delivered')
  })

  it('shows a mark-read failure on the row it happened on', async () => {
    listNotifications.mockResolvedValue(fallback)
    markRead.mockRejectedValue(new Error('Write refused'))
    await renderCard(fallback)
    fireEvent.click(
      screen.getByRole('button', { name: 'Mark as read: Webhook delivered' })
    )
    // The failure renders inside the row that produced it, not at the panel
    // foot far below the button.
    await screen.findByText(/Could not mark the notification read/)
    const row = screen.getByText('Webhook delivered').closest('[role="listitem"]')
    expect(row?.textContent).toContain('Could not mark the notification read.')
  })

  it('counts the unread rows behind “Mark all read” as a plural', async () => {
    // The screen-reader suffix on the bulk button is a plural message, not a
    // count glued to an English `s`: one unread row reads “1 unread”.
    listNotifications.mockReturnValue(new Promise(() => {}))
    const { unmount } = await renderCard(fallback)
    expect(screen.getByRole('button', { name: /Mark all read/ }).textContent).toContain(
      '1 unread'
    )
    unmount()
    await renderCard(allUnread)
    expect(screen.getByRole('button', { name: /Mark all read/ }).textContent).toContain(
      '2 unread'
    )
  })

  it('shows a mark-all failure once, outside the rows', async () => {
    listNotifications.mockResolvedValue(allUnread)
    markRead.mockRejectedValue(new Error('Write refused'))
    await renderCard(allUnread)
    fireEvent.click(screen.getByRole('button', { name: /Mark all read/ }))
    // One alert for the bulk action — it is not repeated on every row.
    await screen.findByText(/Could not mark the notification read/)
    expect(screen.getAllByText(/Could not mark the notification read/)).toHaveLength(1)
    expect(
      screen
        .getByText(/Could not mark the notification read/)
        .closest('[role="listitem"]')
    ).toBeNull()
  })
})
