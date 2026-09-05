import { fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  LiveNotifications,
  type ListNotifications,
  type MarkNotificationsRead,
  type NotificationPreview
} from './live-notifications'
import { renderWithQueryClient } from '@/test/query-harness'

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
  return renderWithQueryClient(
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

  it('renders fallback notifications while a refresh is in flight', () => {
    listNotifications.mockReturnValue(new Promise(() => {}))
    renderCard(fallback)
    screen.getByText('Webhook delivered')
    screen.getByText('Catalog refreshed')
    // Only the unread notification gets the "New" badge.
    expect(screen.getAllByText('New')).toHaveLength(1)
  })

  it('renders each row’s timestamp in UTC', () => {
    listNotifications.mockReturnValue(new Promise(() => {}))
    renderCard(fallback)
    // The mono UTC convention the tables use, on the feed’s rows too.
    expect(screen.getAllByText(/UTC/)).toHaveLength(2)
    screen.getByText(/Sep 4, 2026, 9:12 AM UTC/)
    screen.getByText(/Sep 3, 2026, 6:00 PM UTC/)
  })

  it('shows the caught-up empty state when there are no notifications', () => {
    listNotifications.mockReturnValue(new Promise(() => {}))
    renderCard([])
    screen.getByText(/all caught up/)
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
    renderCard(fallback)
    await screen.findByText('New module ready')
    expect(listNotifications).toHaveBeenCalledWith({
      data: { workspaceSlug: 'starter-lab' }
    })
    expect(screen.queryByText('Webhook delivered')).toBeNull()
  })

  it('keeps the fallback visible and shows an alert when the refresh fails', async () => {
    listNotifications.mockRejectedValue(new Error('Session expired'))
    renderCard(fallback)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Session expired')
    screen.getByText('Webhook delivered')
  })

  it('shows a mark-read failure on the row it happened on', async () => {
    listNotifications.mockResolvedValue(fallback)
    markRead.mockRejectedValue(new Error('Write refused'))
    renderCard(fallback)
    fireEvent.click(
      screen.getByRole('button', { name: 'Mark read: Webhook delivered' })
    )
    // The failure renders inside the row that produced it, not at the panel
    // foot far below the button.
    await screen.findByText(/Write refused/)
    const row = screen.getByText('Webhook delivered').closest('[role="listitem"]')
    expect(row?.textContent).toContain('Write refused')
  })

  it('shows a mark-all failure once, outside the rows', async () => {
    listNotifications.mockResolvedValue(allUnread)
    markRead.mockRejectedValue(new Error('Write refused'))
    renderCard(allUnread)
    fireEvent.click(screen.getByRole('button', { name: /Mark all read/ }))
    // One alert for the bulk action — it is not repeated on every row.
    await screen.findByText(/Write refused/)
    expect(screen.getAllByText(/Write refused/)).toHaveLength(1)
    expect(screen.getByText(/Write refused/).closest('[role="listitem"]')).toBeNull()
  })
})
