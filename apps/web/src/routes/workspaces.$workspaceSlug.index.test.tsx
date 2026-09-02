import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import { renderWithRouter } from '@/test/router-harness'
import {
  type ListNotifications,
  type MarkNotificationsRead
} from '@/components/live-notifications'
import {
  loadWorkspaceDashboard,
  type WorkspaceDashboardPayload
} from '@/lib/server/workspace-dashboard'
import { WorkspaceDashboardPage } from './workspaces.$workspaceSlug.index'

/**
 * The payload comes from the real loader against the Seed layer rather than a
 * hand-written fixture, so a change to the payload shape cannot pass here while
 * failing in the app. `usr_demo` owns `starter-lab`; `usr_dev` is a member.
 */
const listNotifications = vi.fn<ListNotifications>(async () => [
  {
    id: 'not_email',
    title: 'Email needs configuration',
    message: 'Set it up.',
    read: false
  }
])
const markNotificationsRead = vi.fn<MarkNotificationsRead>(async () => 1)

async function renderDashboard(data: WorkspaceDashboardPayload) {
  return renderWithRouter(
    <QueryClientProvider client={new QueryClient()}>
      <WorkspaceDashboardPage
        data={data}
        ports={{ listNotifications, markNotificationsRead }}
      />
    </QueryClientProvider>,
    {
      path: '/workspaces/starter-lab',
      destinations: [
        '/workspaces/starter-lab/settings',
        '/workspaces/starter-lab/members',
        '/workspaces/starter-lab/api-tokens',
        '/workspaces/starter-lab/webhooks',
        '/workspaces/starter-lab/audit'
      ]
    }
  )
}

describe('WorkspaceDashboardPage', () => {
  it('renders the attention feed, notifications, and webhook delivery for an owner', async () => {
    const rendered = await renderDashboard(
      await loadWorkspaceDashboard({ workspaceSlug: 'starter-lab', userId: 'usr_demo' })
    )
    await rendered.findByText('Needs attention')
    // The seed's standing attention items: one token minted but never used,
    // and the newest audit events as informational entries.
    screen.getByText(/never used/)
    screen.getByText('API token created')
    // The chart trails the feed.
    screen.getByText('Webhook delivery')
  })

  it('offers mark-as-read and reports the change through the port', async () => {
    await renderDashboard(
      await loadWorkspaceDashboard({ workspaceSlug: 'starter-lab', userId: 'usr_demo' })
    )
    // The unread notification offers its own mark-read control...
    await screen.findByRole('button', {
      name: 'Mark read: Email needs configuration'
    })
    // ...and the panel a mark-all control over every unread id.
    fireEvent.click(screen.getByText(/Mark all read/))
    await vi.waitFor(() =>
      expect(markNotificationsRead).toHaveBeenCalledWith({
        data: { workspaceSlug: 'starter-lab', ids: ['not_email'] }
      })
    )
  })

  it('omits every gated segment for a member, who holds no owner permissions', async () => {
    await renderDashboard(
      await loadWorkspaceDashboard({ workspaceSlug: 'starter-lab', userId: 'usr_dev' })
    )
    // A member's payload carries no readable segments beyond the feed itself,
    // so the attention list is absent rather than empty, and so is the chart.
    expect(screen.queryByText('Needs attention')).toBeNull()
    expect(screen.queryByText('Webhook delivery')).toBeNull()
    // The rest of the dashboard still renders.
    screen.getByText('Notifications')
  })
})
