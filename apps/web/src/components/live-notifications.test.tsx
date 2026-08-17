import { type ReactElement } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LiveNotifications,
  type ListNotifications,
  type NotificationPreview
} from './live-notifications'

// The card's own `listNotifications` port, handed in as a prop. A real function
// of the declared shape, so the module under test is the one that ships.
const listNotifications = vi.fn<ListNotifications>()

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

function renderCard(cardFallback: readonly NotificationPreview[]) {
  return renderWithClient(
    <LiveNotifications
      workspaceSlug="starter-lab"
      fallback={cardFallback}
      listNotifications={listNotifications}
    />
  )
}

describe('LiveNotifications', () => {
  beforeEach(() => {
    listNotifications.mockReset()
  })

  it('renders fallback notifications while a refresh is in flight', () => {
    listNotifications.mockReturnValue(new Promise(() => {}))
    renderCard(fallback)
    screen.getByText('Webhook delivered')
    screen.getByText('Catalog refreshed')
    // Only the unread notification gets the "New" badge.
    expect(screen.getAllByText('New')).toHaveLength(1)
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
        read: false
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
})
