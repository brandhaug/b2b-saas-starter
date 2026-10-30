import { fireEvent, screen, waitFor, within } from '@testing-library/dom'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { input } from '@/components/native-test-harness'
import { renderAccount, deferred } from './test-runtime'
import * as Admin from './admin'
import { UserAdminRefusedError } from '@/lib/capability-error'

const ports = vi.hoisted(() => ({
  ban: vi.fn(),
  unban: vi.fn(),
  impersonate: vi.fn(),
  users: vi.fn(),
  memberships: vi.fn(),
  role: vi.fn(),
  transition: vi.fn(),
  workspaces: vi.fn(),
  replay: vi.fn(),
  failures: vi.fn()
}))
vi.mock('@/lib/server/admin', () => ({
  banSystemUserServerFn: ports.ban,
  unbanSystemUserServerFn: ports.unban,
  impersonateUserServerFn: ports.impersonate,
  listSystemUsersServerFn: ports.users,
  listUserWorkspacesServerFn: ports.memberships,
  changeUserWorkspaceRoleServerFn: ports.role,
  transitionAdminWorkspaceServerFn: ports.transition,
  listAdminWorkspacesServerFn: ports.workspaces,
  replayFailedDeliveryServerFn: ports.replay,
  loadFailedDeliveriesServerFn: ports.failures
}))
const user = {
  id: 'usr_dev',
  name: 'Dev Member',
  email: 'dev@starter.local',
  role: 'user' as const,
  banned: false
}
const membership = {
  workspace: { id: 'wrk_1', slug: 'starter-lab', name: 'Starter Lab', planId: 'team' },
  member: { ...user, role: 'member' as const, systemRole: 'user' as const }
}
const failurePage: Admin.Flags['failedDeliveries'] = {
  items: [
    {
      id: 'whd_terminal',
      endpointId: 'wh_failed',
      endpointUrl: 'https://receiver.example.com/hook',
      endpointEnabled: false,
      endpointConsecutiveFailures: 20,
      endpointFailureLimitReached: true,
      eventType: 'demo.event',
      status: 'dead_lettered',
      attempts: 6,
      lastAttemptAt: '2026-09-01T00:00:00.000Z',
      responseStatus: 503,
      workspace: {
        id: 'wrk_1',
        slug: 'first-workspace',
        name: 'First workspace',
        planId: 'team'
      }
    }
  ],
  nextCursor: 'older-cursor'
}
const location = window.location
beforeEach(() => {
  vi.resetAllMocks()
  Object.defineProperty(window, 'location', { configurable: true, value: location })
  window.history.replaceState(null, '', '/admin')
  ports.users.mockResolvedValue([user])
  ports.memberships.mockResolvedValue([membership])
  ports.role.mockResolvedValue({ ...membership.member, role: 'admin' })
  ports.workspaces.mockResolvedValue([])
  ports.failures.mockResolvedValue(failurePage)
})
function render(overrides: Partial<Admin.Flags> = {}) {
  return renderAccount({
    admin: Admin.init({
      users: [user],
      events: [],
      workspaces: [],
      failedDeliveries: { items: [], nextCursor: null },
      emailDeliveries: [],
      search: '',
      ...overrides
    }).model
  })
}
async function click(name: string | RegExp) {
  fireEvent.click(await screen.findByRole('button', { name }))
}
async function confirm(name: string) {
  fireEvent.click(
    within(await screen.findByRole('alertdialog')).getByRole('button', { name })
  )
}

describe('admin-confirmations migration', () => {
  it('keeps a failed ban visible in its confirmation dialog', async () => {
    ports.ban.mockRejectedValue(new Error('request blocked'))
    await render()
    await click('Ban dev@starter.local')
    await confirm('Ban')
    const dialog = screen.getByRole('alertdialog')
    expect(await within(dialog).findByText('Ban failed')).not.toBeNull()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).not.toBeNull()
  })

  it('closes the ban confirmation after a successful request', async () => {
    ports.ban.mockResolvedValue(undefined)
    await render()
    await click('Ban dev@starter.local')
    await confirm('Ban')
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(ports.ban).toHaveBeenCalledWith({ data: { userId: 'usr_dev' } })
    expect(ports.users).toHaveBeenCalledTimes(1)
  })

  it('keeps a failed impersonation visible in its confirmation dialog', async () => {
    ports.impersonate.mockRejectedValue(new Error('request blocked'))
    await render()
    await click('Impersonate dev@starter.local?')
    await confirm('Impersonate')
    const dialog = screen.getByRole('alertdialog')
    expect(await within(dialog).findByText('Impersonation failed')).not.toBeNull()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).not.toBeNull()
  })

  it('navigates away after a successful impersonation request', async () => {
    const assign = vi.fn()
    Object.defineProperty(window, 'location', { configurable: true, value: { assign } })
    ports.impersonate.mockResolvedValue({ userId: 'usr_dev', expiresInSeconds: 900 })
    await render()
    await click('Impersonate dev@starter.local?')
    await confirm('Impersonate')
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/workspaces'))
  })
})
describe('admin-user-actions migration', () => {
  it('loads the memberships and names each role button by its workspace', async () => {
    await render()
    await click(/Load workspaces/)
    await screen.findByRole('button', { name: 'Make admin: Starter Lab' })
    expect(
      screen.getByRole('button', { name: 'Make owner: Starter Lab' })
    ).not.toBeNull()
    expect(
      screen.queryByRole('button', { name: 'Make member: Starter Lab' })
    ).toBeNull()
    expect(ports.memberships).toHaveBeenCalledWith({ data: { userId: 'usr_dev' } })
  })

  it('re-reads the memberships after a role change', async () => {
    await render()
    await click(/Load workspaces/)
    await click('Make admin: Starter Lab')
    await waitFor(() =>
      expect(ports.role).toHaveBeenCalledWith({
        data: { userId: 'usr_dev', workspaceId: 'wrk_1', role: 'admin' }
      })
    )
    await waitFor(() => expect(ports.memberships).toHaveBeenCalledTimes(2))
  })

  it('shows a failed read as a message instead of an unhandled rejection', async () => {
    ports.memberships.mockRejectedValue(new Error('Admin session expired'))
    await render()
    await click(/Load workspaces/)
    await screen.findByText('Failed to load workspaces')
    expect(screen.queryByText('Admin session expired')).toBeNull()
  })

  it('explains a workspace refusal instead of a generic role-change failure', async () => {
    ports.role.mockRejectedValue(
      new UserAdminRefusedError('You are not allowed to update this member')
    )
    await render()
    await click(/Load workspaces/)
    await click('Make admin: Starter Lab')
    await screen.findByText(
      'The workspace refused this change: a System Admin can only change a membership in a workspace where they are also an admin or owner. The system role confers nothing inside a workspace.'
    )
    expect(screen.queryByText('Role change failed')).toBeNull()
  })
})
describe('workspace-suspension-panel migration', () => {
  function workspace(status: 'active' | 'suspended'): Admin.Flags['workspaces'] {
    return [
      {
        id: 'wrk_1',
        slug: 'starter-lab',
        name: 'Starter Lab',
        suspension: {
          workspaceId: 'wrk_1',
          status,
          customerExplanation: null,
          changedAt: '2026-09-07T10:00:00Z',
          changedByUserId: null
        }
      }
    ]
  }

  it('requires both reasons and keeps the internal note separate', async () => {
    await render({ workspaces: workspace('active') })
    expect(screen.getByRole('button', { name: 'Suspend workspace' })).toHaveProperty(
      'disabled',
      true
    )
    await input(screen.getByLabelText('Internal reason'), 'Abuse review')
    expect(screen.getByRole('button', { name: 'Suspend workspace' })).toHaveProperty(
      'disabled',
      true
    )
    await input(
      screen.getByLabelText('Customer explanation'),
      'Please contact support.'
    )
    expect(screen.getByRole('button', { name: 'Suspend workspace' })).toHaveProperty(
      'disabled',
      false
    )
    await click('Suspend workspace')
    await waitFor(() =>
      expect(ports.transition).toHaveBeenCalledWith({
        data: {
          workspaceId: 'wrk_1',
          action: 'suspend',
          internalReason: 'Abuse review',
          customerExplanation: 'Please contact support.'
        }
      })
    )
  })

  it('offers an idempotent reactivation action for suspended state', async () => {
    await render({ workspaces: workspace('suspended') })
    expect(screen.queryByLabelText('Customer explanation')).toBeNull()
    await input(screen.getByLabelText('Internal reason'), 'Reactivate workspace')
    await click('Reactivate workspace')
    await waitFor(() =>
      expect(ports.transition).toHaveBeenCalledWith({
        data: {
          workspaceId: 'wrk_1',
          action: 'unsuspend',
          internalReason: 'Reactivate workspace'
        }
      })
    )
  })
})
describe('admin-failed-deliveries migration', () => {
  it('identifies disabled endpoints at the failure limit and shows the server refusal inline', async () => {
    ports.replay.mockResolvedValue({
      status: 'refused',
      reason: 'Endpoint was disabled. Re-enable it in the workspace.'
    })
    await render({ failedDeliveries: failurePage })
    expect(screen.getByText(/Auto-disable threshold reached/)).not.toBeNull()
    expect(screen.getByText('First workspace')).not.toBeNull()
    await click('Replay whd_terminal')
    await screen.findByText('Endpoint was disabled. Re-enable it in the workspace.')
  })

  it('acknowledges a queued copy without hiding the source or offering an immediate duplicate', async () => {
    ports.replay.mockResolvedValue({ status: 'queued', deliveryId: 'whd_copy' })
    await render({ failedDeliveries: failurePage })
    await click('Replay whd_terminal')
    await screen.findByText(/Queued as whd_copy/)
    expect(
      within(
        screen.getByRole('table', { name: 'Failed webhook deliveries' })
      ).getByText('sent to dead-letter queue')
    ).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Replay whd_terminal' })).toHaveProperty(
      'disabled',
      true
    )
  })

  it('puts the opaque cursor in the URL and clears it when returning to newest', async () => {
    await render({ failedDeliveries: failurePage })
    await click('Older failures')
    await waitFor(() =>
      expect(new URLSearchParams(window.location.search).get('failureCursor')).toBe(
        'older-cursor'
      )
    )
    expect(ports.failures).toHaveBeenCalledWith({ data: { cursor: 'older-cursor' } })
    await click('Refresh newest')
    await waitFor(() =>
      expect(new URLSearchParams(window.location.search).has('failureCursor')).toBe(
        false
      )
    )
  })

  it('shows a failed enqueue instead of claiming success', async () => {
    ports.replay.mockRejectedValue(new Error('Queue unavailable'))
    await render({ failedDeliveries: failurePage })
    await click('Replay whd_terminal')
    await screen.findByText(/Replay failed\. A pending copy may already exist\./)
    expect(screen.queryByText(/Queued as/)).toBeNull()
  })

  it('disables replay while enqueue is pending and permits retry after refusal', async () => {
    const response = deferred<{ status: 'refused'; reason: string }>()
    ports.replay.mockReturnValue(response.promise)
    await render({ failedDeliveries: failurePage })
    await click('Replay whd_terminal')
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Replay whd_terminal' })
      ).toHaveProperty('disabled', true)
    )
    expect(screen.queryByText(/Queued as/)).toBeNull()
    response.resolve({ status: 'refused', reason: 'Endpoint is disabled' })
    await screen.findByText('Endpoint is disabled')
    expect(screen.getByRole('button', { name: 'Replay whd_terminal' })).toHaveProperty(
      'disabled',
      false
    )
  })

  it('keeps server order and disables pagination on the last page', async () => {
    const first = failurePage.items[0]
    if (!first) {
      throw new Error('Missing failure fixture')
    }
    await render({
      failedDeliveries: {
        items: [
          first,
          { ...first, id: 'whd_second', endpointUrl: 'https://a.example.com/hook' }
        ],
        nextCursor: null
      }
    })
    expect(screen.getByRole('button', { name: 'Older failures' })).toHaveProperty(
      'disabled',
      true
    )
    const table = screen.getByRole('table', { name: 'Failed webhook deliveries' })
    const rows = within(table).getAllByRole('row')
    expect(rows[1]?.textContent).toContain('receiver.example.com')
    expect(rows[2]?.textContent).toContain('a.example.com')
    expect(within(table).queryByRole('button', { name: /Sort by/ })).toBeNull()
  })
})
