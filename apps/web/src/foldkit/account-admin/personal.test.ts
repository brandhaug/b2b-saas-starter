import { fireEvent, screen, waitFor, within } from '@testing-library/dom'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { input } from '@/components/native-test-harness'
import { renderAccount, deferred } from './test-runtime'
import * as Personal from './personal'
import { UiError } from '@/lib/ui-error'
import {
  describeDeleteFailure,
  ACCOUNT_DELETION_BLOCKED_NAME,
  ACCOUNT_DELETION_REJECTED_NAME
} from '@/lib/delete-account-failure'
import { loadAccountPageHandler } from '@/lib/server/account.effects'
import { fixtureSession } from '@/test/fixture-session'
import type * as AuthModule from '@/lib/server/auth'

const ports = vi.hoisted(() => ({
  remove: vi.fn(),
  request: vi.fn(),
  download: vi.fn()
}))
vi.mock('@/lib/server/account', () => ({
  deleteAccountServerFn: ports.remove,
  exportPersonalDataServerFn: ports.request,
  downloadPersonalDataServerFn: ports.download
}))
vi.mock('@/lib/server/auth', async (original) => ({
  ...(await original<typeof AuthModule>()),
  requireRequestSession: async () => fixtureSession({ userId: 'usr_demo' })
}))
const assign = vi.fn()
beforeEach(() => {
  vi.resetAllMocks()
  ports.remove.mockResolvedValue({ canDelete: true, steps: [] })
  ports.download.mockResolvedValue({ fileName: 'personal-data.json', json: '{}' })
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      href: 'http://localhost:3000/account',
      origin: 'http://localhost:3000',
      pathname: '/account',
      search: '',
      hash: '',
      assign
    }
  })
})
type Plan = NonNullable<Personal.Flags['account']>['deletionPlan']
const workspace = { id: 'wrk_1', name: 'Acme Lab', slug: 'acme-lab', planId: 'team' }
const deletable: Plan = {
  canDelete: true,
  steps: [{ workspace, role: 'owner', action: 'leave' }]
}
function render(plan: Plan = deletable, impersonating = false) {
  return renderAccount({
    personal: Personal.init({
      account: { deletionPlan: plan, preferences: [] },
      connections: [],
      conversations: null,
      impersonating,
      locale: 'en',
      timeZone: 'UTC'
    }).model
  })
}
function click(name: string) {
  fireEvent.click(screen.getByRole('button', { name }))
}
async function remove() {
  await input(screen.getByLabelText('Password'), 'correct-horse-battery-staple')
  click('Delete account')
  fireEvent.click(
    within(await screen.findByRole('alertdialog')).getByRole('button', {
      name: 'Yes, delete my account'
    })
  )
}
describe('delete-account-panel migration', () => {
  it('names a billing-blocked workspace and links to its billing settings', async () => {
    await render({
      canDelete: false,
      steps: [{ workspace, role: 'owner', action: 'blocked_billing_workspace' }]
    })
    expect(
      screen.getByText(
        'Acme Lab has unresolved billing activity. Review billing or contact support before deleting your account.'
      )
    ).not.toBeNull()
    expect(screen.getByRole('link', { name: 'Acme Lab' }).getAttribute('href')).toBe(
      '/workspaces/acme-lab/billing'
    )
    expect(screen.queryByLabelText('Password')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete account' })).toBeNull()
  })

  it('sends the password after the confirm step and leaves for /sign-in', async () => {
    await render()
    await remove()
    await waitFor(() =>
      expect(ports.remove).toHaveBeenCalledWith({
        data: { password: 'correct-horse-battery-staple' }
      })
    )
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/sign-in'))
  })

  it('shows the wrong-password refusal as copy, not a crash', async () => {
    ports.remove.mockRejectedValue(
      Object.assign(new Error('invalid_password'), { name: 'AccountDeletionRejected' })
    )
    await render()
    await remove()
    await within(screen.getByRole('alertdialog')).findByText(
      'That password is not correct.'
    )
    expect(assign).not.toHaveBeenCalled()
  })

  it('renders the blocked state as members-page links with no delete control', async () => {
    await render({
      canDelete: false,
      steps: [{ workspace, role: 'owner', action: 'blocked_sole_owner' }]
    })
    expect(screen.getByText(/Transfer ownership first/i)).not.toBeNull()
    expect(screen.getByRole('link', { name: 'Acme Lab' }).getAttribute('href')).toBe(
      '/workspaces/acme-lab/members'
    )
    expect(screen.queryByLabelText('Password')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete account' })).toBeNull()
  })

  it('names a suspended workspace and directs the user to support', async () => {
    await render({
      canDelete: false,
      steps: [{ workspace, role: 'owner', action: 'blocked_suspended_workspace' }]
    })
    expect(
      screen.getByText(
        'Acme Lab is suspended. Contact support before deleting your account.'
      )
    ).not.toBeNull()
    expect(screen.queryByLabelText('Password')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete account' })).toBeNull()
  })

  it('maps the two typed refusals to their sentences by serialized name', () => {
    expect(
      describeDeleteFailure(
        Object.assign(new Error('x'), { name: ACCOUNT_DELETION_REJECTED_NAME })
      )
    ).toBe('That password is not correct.')
    expect(
      describeDeleteFailure(
        Object.assign(new Error('x'), { name: ACCOUNT_DELETION_BLOCKED_NAME })
      )
    ).toBe('A workspace is blocking account deletion. Reload this page to review it.')
    expect(describeDeleteFailure(new Error('boom'))).toBe(
      'Could not delete the account'
    )
    expect(describeDeleteFailure(undefined)).toBe('Could not delete the account')
  })
})
describe('personal-data-export-panel migration', () => {
  it('keeps the request control busy until preparation finishes, then offers download', async () => {
    const response = deferred<{ id: string; expiresAt: string }>()
    ports.request.mockReturnValue(response.promise)
    await render()
    click('Prepare personal data')
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Prepare personal data' })
      ).toHaveProperty('disabled', true)
    )
    expect(screen.queryByRole('button', { name: 'Download personal data' })).toBeNull()
    response.resolve({ id: 'export-1', expiresAt: '2026-09-16T12:00:00.000Z' })
    await screen.findByRole('button', { name: 'Download personal data' })
    ports.download.mockRejectedValue(new Error('download unavailable'))
    click('Download personal data')
    await waitFor(() =>
      expect(ports.download).toHaveBeenCalledWith({ data: { exportId: 'export-1' } })
    )
    await screen.findByText('Could not download your personal data export. Try again.')
  })

  it('shows a safe request failure and clears it when retry succeeds', async () => {
    ports.request
      .mockRejectedValueOnce(new Error('private server detail'))
      .mockResolvedValue({ id: 'export-2', expiresAt: '2026-09-16T12:00:00.000Z' })
    ports.download
      .mockRejectedValueOnce(new Error('private download detail'))
      .mockResolvedValue({ fileName: 'personal-data.json', json: '{}' })
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test-export')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    await render()
    click('Prepare personal data')
    await screen.findByText('Could not prepare your personal data export. Try again.')
    expect(screen.queryByText('private server detail')).toBeNull()
    click('Prepare personal data')
    await screen.findByRole('button', { name: 'Download personal data' })
    expect(ports.request).toHaveBeenCalledTimes(2)
    expect(
      screen.queryByText('Could not prepare your personal data export. Try again.')
    ).toBeNull()
    click('Download personal data')
    await screen.findByText('Could not download your personal data export. Try again.')
    expect(screen.queryByText('private download detail')).toBeNull()
    click('Download personal data')
    await waitFor(() => expect(ports.download).toHaveBeenCalledTimes(2))
    await waitFor(() =>
      expect(
        screen.queryByText('Could not download your personal data export. Try again.')
      ).toBeNull()
    )
  })

  it('returns recent-authentication failures to verification', async () => {
    ports.request.mockRejectedValue(
      new UiError('strong_authentication_required', {}, 'verify')
    )
    await render()
    click('Prepare personal data')
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith(
        '/verify-authentication?recent=true&redirect=%2Faccount'
      )
    )
  })
})
describe('account route migration', () => {
  it('loads the real plan for a seed member: deletable, leave step', async () => {
    const { deletionPlan } = await loadAccountPageHandler()
    expect(deletionPlan.canDelete).toBe(true)
    expect(deletionPlan.steps).toHaveLength(1)
    expect(deletionPlan.steps[0]?.workspace.slug).toBe('starter-lab')
    expect(deletionPlan.steps[0]?.action).toBe('leave')
  })

  it('shows the deletion consequences for an ordinary session', async () => {
    const payload = await loadAccountPageHandler()
    await render(payload.deletionPlan)
    expect(
      screen.getByText(/You leave workspace Starter Lab\. Other owners keep it\./)
    ).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Delete account' })).not.toBeNull()
  })

  it('hides the account controls from an impersonation session', async () => {
    const payload = await loadAccountPageHandler()
    await render(payload.deletionPlan, true)
    expect(
      screen.getByText('The account cannot be deleted while impersonating this user.')
    ).not.toBeNull()
    expect(
      screen.getByText(
        'Personal data cannot be exported while impersonating this user.'
      )
    ).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Prepare personal data' })).toBeNull()
    expect(screen.queryByLabelText('Password')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete account' })).toBeNull()
  })
})
