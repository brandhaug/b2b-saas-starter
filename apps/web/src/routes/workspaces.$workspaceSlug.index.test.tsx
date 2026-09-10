// oxlint-disable-next-line import/no-unassigned-import -- Installs the explicit authenticated-session test fixture.
import '@/test/qualified-session'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { renderWithRouter } from '@/test/router-harness'
import {
  type ListNotifications,
  type MarkNotificationsRead
} from '@/components/live-notifications'
import { fixtureSession } from '@/test/fixture-session'
import { loadWorkspaceDashboardHandler } from '@/lib/server/workspace-dashboard.effects'
import { type WorkspaceDashboardPayload } from '@/lib/server/workspace-dashboard'
import { WorkspaceDashboardPage } from '@/components/workspace-dashboard-page'
import type * as AuthModule from '@/lib/server/auth'

/**
 * The payload comes from the real loader handler against the Seed layer
 * rather than a hand-written fixture, so a change to the payload shape
 * cannot pass here while failing in the app. `usr_demo` owns
 * `starter-lab`; `usr_dev` is a member. The handler's session gate is
 * answered by the mock with the identity each case wants.
 */
const actor = vi.hoisted(() => ({ userId: 'usr_demo' }))

vi.mock('@/lib/server/auth', async (importOriginal) => {
  const { Effect } = await import('effect')
  return {
    ...(await importOriginal<typeof AuthModule>()),
    requireRequestSession: async () => fixtureSession(actor),
    requireRequestSessionEffect: () => Effect.succeed(fixtureSession(actor))
  }
})

// Reset rather than restore-in-test-body: a failed assertion between the
// `usr_dev` flip and a trailing restore must not leak the member identity
// into the next case.
beforeEach(() => {
  actor.userId = 'usr_demo'
})

async function loadDashboard(): Promise<WorkspaceDashboardPayload> {
  return loadWorkspaceDashboardHandler({ workspaceSlug: 'starter-lab' })
}
// One unread notification stands in for the seed feed. The panel trusts the
// loader payload on mount (no refetch until it goes stale), so the fixture
// rides in as the payload's notifications and the port answers only explicit
// refreshes.
const fixtureNotifications: WorkspaceDashboardPayload['notifications'] = [
  {
    id: 'not_email',
    kind: 'announcement',
    title: 'Email needs configuration',
    message: 'Set it up.',
    read: false,
    // The seed row's own timestamp, so the fixture mirrors the real feed.
    createdAt: '2026-05-16T08:10:00.000Z'
  }
]
const listNotifications = vi.fn<ListNotifications>(async () => fixtureNotifications)
const markNotificationsRead = vi.fn<MarkNotificationsRead>(async () => 1)

async function renderDashboard(payload: WorkspaceDashboardPayload) {
  const data = { ...payload, notifications: fixtureNotifications }
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
        '/workspaces/starter-lab/audit',
        '/workspaces/starter-lab/billing',
        '/account'
      ]
    }
  )
}

describe('WorkspaceDashboardPage', () => {
  it('renders attention and notifications without duplicating delivery reports', async () => {
    const rendered = await renderDashboard(await loadDashboard())
    await rendered.findByText('Needs attention')
    // Attention stays actionable; the audit page owns recent history.
    screen.getByText(/never used/)
    expect(screen.queryByText('API token created')).toBeNull()
    expect(screen.queryByText('Webhook delivery')).toBeNull()
  })

  it('offers mark-as-read and reports the change through the port', async () => {
    await renderDashboard(await loadDashboard())
    // The unread notification offers its own mark-read control...
    await screen.findByRole('button', {
      name: 'Mark as read: Email needs configuration'
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
    actor.userId = 'usr_dev'
    await renderDashboard(await loadDashboard())
    // A member's payload carries no readable segments beyond the feed itself,
    // so the attention list is absent rather than empty, and so is the chart.
    expect(screen.queryByText('Needs attention')).toBeNull()
    expect(screen.queryByText('Webhook delivery')).toBeNull()
    // The rest of the dashboard still renders.
    screen.getByText('Notifications')
  })

  it('shows the owner the Seed Workspace checklist with a dismiss control', async () => {
    await renderDashboard(await loadDashboard())
    screen.getByText('3 of 4')
    screen.getByRole('button', { name: 'Dismiss' })
  })

  it('shows a member the checklist read-only, without the developer-platform steps', async () => {
    actor.userId = 'usr_dev'
    await renderDashboard(await loadDashboard())
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull()
    expect(screen.queryByText('Create an API token')).toBeNull()
  })
})
