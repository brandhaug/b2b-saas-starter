import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import { renderWithRouter } from '@/test/router-harness'
import { type ListNotifications } from '@/components/live-notifications'
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
const listNotifications = vi.fn<ListNotifications>(async () => [])

async function renderDashboard(data: WorkspaceDashboardPayload) {
  const rendered = await renderWithRouter(
    <QueryClientProvider client={new QueryClient()}>
      <WorkspaceDashboardPage data={data} ports={{ listNotifications }} />
    </QueryClientProvider>,
    {
      path: '/workspaces/starter-lab',
      destinations: ['/workspaces/starter-lab/settings']
    }
  )
  await screen.findByText('Notifications')
  return rendered
}

describe('WorkspaceDashboardPage', () => {
  it('renders webhook delivery for an actor who may list endpoints', async () => {
    await renderDashboard(
      await loadWorkspaceDashboard({ workspaceSlug: 'starter-lab', userId: 'usr_demo' })
    )
    screen.getByText('Webhook delivery')
  })

  it('omits webhook delivery for a member, who holds no webhook:list', async () => {
    await renderDashboard(
      await loadWorkspaceDashboard({ workspaceSlug: 'starter-lab', userId: 'usr_dev' })
    )
    expect(screen.queryByText('Webhook delivery')).toBeNull()
    // The rest of the dashboard still renders.
    screen.getByText('Notifications')
  })
})
