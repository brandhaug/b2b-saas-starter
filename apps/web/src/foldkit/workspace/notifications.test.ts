// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from '@testing-library/dom'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { demoFixtures } from '@/lib/demo-fixtures'
import * as Dashboard from '@/lib/server/workspace-dashboard'
import * as Notifications from '@/lib/server/notifications'
import { renderWorkspace } from './test-harness'

const fallback = [
  {
    id: 'n1',
    kind: 'announcement' as const,
    title: 'Webhook delivered',
    message: 'Delivery succeeded.',
    read: false,
    createdAt: '2026-09-04T09:12:00.000Z'
  },
  {
    id: 'n2',
    kind: 'announcement' as const,
    title: 'Catalog refreshed',
    message: 'Refresh completed.',
    read: true,
    createdAt: '2026-09-03T18:00:00.000Z'
  }
]
const allUnread = fallback.map((item) => ({ ...item, read: false }))
function renderCard(notifications = fallback) {
  return renderWorkspace(
    { _tag: 'dashboard', data: { ...demoFixtures.dashboard, notifications } },
    { url: '/workspaces/starter-lab/notifications' }
  )
}
beforeEach(() => {
  vi.spyOn(Dashboard, 'loadWorkspaceDashboardServerFn').mockResolvedValue({
    ...demoFixtures.dashboard,
    notifications: fallback
  })
  vi.spyOn(Notifications, 'markNotificationsReadServerFn').mockResolvedValue(1)
})
describe('notification feed preserved behaviors', () => {
  it('renders fallback notifications while a refresh is in flight', async () => {
    vi.mocked(Dashboard.loadWorkspaceDashboardServerFn).mockImplementation(
      () => new Promise(() => {})
    )
    await renderCard()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh notifications' }))
    expect(screen.getByText('Webhook delivered')).not.toBeNull()
    expect(screen.getByText('Catalog refreshed')).not.toBeNull()
    expect(screen.getAllByText('New')).toHaveLength(1)
  })

  it('filters read notifications without changing their read state', async () => {
    await renderCard()
    fireEvent.change(screen.getByRole('combobox', { name: 'Show notifications' }), {
      target: { value: 'unread' }
    })
    await waitFor(() => expect(screen.queryByText('Catalog refreshed')).toBeNull())
    expect(screen.getByText('Webhook delivered')).not.toBeNull()
    fireEvent.change(screen.getByRole('combobox', { name: 'Show notifications' }), {
      target: { value: 'all' }
    })
    expect(await screen.findByText('Catalog refreshed')).not.toBeNull()
    expect(Notifications.markNotificationsReadServerFn).not.toHaveBeenCalled()
  })

  it('renders the loader payload without a refetch on mount', async () => {
    await renderCard()
    expect(Dashboard.loadWorkspaceDashboardServerFn).not.toHaveBeenCalled()
    expect(screen.getByText('Webhook delivered')).not.toBeNull()
  })

  it('fetches notifications for the workspace and renders the server data', async () => {
    vi.mocked(Dashboard.loadWorkspaceDashboardServerFn).mockResolvedValue({
      ...demoFixtures.dashboard,
      notifications: [
        {
          ...fallback[0],
          id: 'n3',
          kind: 'announcement',
          title: 'New module ready',
          message: 'Email is configured.',
          read: false,
          createdAt: '2026-09-04T10:00:00.000Z'
        }
      ]
    })
    await renderCard()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh notifications' }))
    expect(await screen.findByText('New module ready')).not.toBeNull()
    expect(Dashboard.loadWorkspaceDashboardServerFn).toHaveBeenCalledWith({
      data: { workspaceSlug: 'starter-lab' }
    })
    expect(screen.queryByText('Webhook delivered')).toBeNull()
  })

  it('keeps the fallback visible and shows an alert when the refresh fails', async () => {
    vi.mocked(Dashboard.loadWorkspaceDashboardServerFn).mockRejectedValue(
      new Error('Session expired')
    )
    await renderCard()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh notifications' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Could not refresh notifications.')
    expect(screen.getByText('Webhook delivered')).not.toBeNull()
  })

  it('shows a mark-read failure on the row it happened on', async () => {
    vi.mocked(Notifications.markNotificationsReadServerFn).mockRejectedValue(
      new Error('Write refused')
    )
    await renderCard()
    fireEvent.click(
      screen.getByRole('button', { name: 'Mark as read: Webhook delivered' })
    )
    await screen.findByText('Could not mark the notification read.')
    expect(
      screen.getByText('Webhook delivered').closest('[role="listitem"]')?.textContent
    ).toContain('Could not mark the notification read.')
  })

  it('counts the unread rows behind Mark all read as a plural', async () => {
    const view = await renderCard()
    expect(screen.getByRole('button', { name: /Mark all read/ }).textContent).toContain(
      '1 unread'
    )
    view.unmount()
    await renderCard(allUnread)
    expect(screen.getByRole('button', { name: /Mark all read/ }).textContent).toContain(
      '2 unread'
    )
  })

  it('shows a mark-all failure once, outside the rows', async () => {
    vi.mocked(Notifications.markNotificationsReadServerFn).mockRejectedValue(
      new Error('Write refused')
    )
    await renderCard(allUnread)
    fireEvent.click(screen.getByRole('button', { name: /Mark all read/ }))
    await screen.findByText('Could not mark the notification read.')
    expect(screen.getAllByText('Could not mark the notification read.')).toHaveLength(1)
    expect(
      screen
        .getByText('Could not mark the notification read.')
        .closest('[role="listitem"]')
    ).toBeNull()
  })
})
