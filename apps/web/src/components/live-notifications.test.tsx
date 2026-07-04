import type { ReactElement } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listNotifications: vi.fn()
}))

vi.mock('@/lib/server/notifications', () => ({
  listNotificationsServerFn: (input: unknown) => mocks.listNotifications(input),
  notificationsQueryKey: (workspaceSlug: string) =>
    ['notifications', workspaceSlug] as const
}))

import { LiveNotifications, type NotificationPreview } from './live-notifications'

const fallback: readonly NotificationPreview[] = [
  { id: 'n1', title: 'Webhook delivered', message: 'Delivery succeeded.', read: false },
  { id: 'n2', title: 'Catalog refreshed', message: 'Refresh completed.', read: true }
]

function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

describe('LiveNotifications', () => {
  beforeEach(() => {
    mocks.listNotifications.mockReset()
  })

  it('renders fallback notifications while a refresh is in flight', () => {
    mocks.listNotifications.mockReturnValue(new Promise(() => {}))
    renderWithClient(
      <LiveNotifications workspaceSlug="starter-lab" fallback={fallback} />
    )
    screen.getByText('Webhook delivered')
    screen.getByText('Catalog refreshed')
    // Only the unread notification gets the "New" badge.
    expect(screen.getAllByText('New')).toHaveLength(1)
  })

  it('shows the caught-up empty state when there are no notifications', () => {
    mocks.listNotifications.mockReturnValue(new Promise(() => {}))
    renderWithClient(<LiveNotifications workspaceSlug="starter-lab" fallback={[]} />)
    screen.getByText(/all caught up/)
  })

  it('fetches notifications for the workspace and renders the server data', async () => {
    mocks.listNotifications.mockResolvedValue([
      {
        id: 'n3',
        title: 'New module ready',
        message: 'Email is configured.',
        read: false
      }
    ])
    renderWithClient(
      <LiveNotifications workspaceSlug="starter-lab" fallback={fallback} />
    )
    await screen.findByText('New module ready')
    expect(mocks.listNotifications).toHaveBeenCalledWith({
      data: { workspaceSlug: 'starter-lab' }
    })
    expect(screen.queryByText('Webhook delivered')).toBeNull()
  })

  it('keeps the fallback visible and shows an alert when the refresh fails', async () => {
    mocks.listNotifications.mockRejectedValue(new Error('Session expired'))
    renderWithClient(
      <LiveNotifications workspaceSlug="starter-lab" fallback={fallback} />
    )
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Session expired')
    screen.getByText('Webhook delivered')
  })
})
