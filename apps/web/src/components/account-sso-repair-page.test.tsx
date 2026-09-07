import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import { renderWithRouter } from '@/test/router-harness'
import { AccountSsoRepairPage } from './account-sso-repair-page'
import { type RouteSession } from '@/lib/server/auth'
import { type SsoConnection } from '@b2b-saas-starter/capabilities/governance/workspace-sso-connections'

const calls = vi.hoisted(() => ({ activate: vi.fn(), load: vi.fn(), update: vi.fn() }))
vi.mock('@/lib/server/sso-recovery', () => ({
  activateSsoRecoveryServerFn: calls.activate,
  loadSsoRecoveryServerFn: calls.load,
  updateSsoRecoveryServerFn: calls.update
}))

const session = {
  user: {
    id: 'usr_owner',
    name: 'Owner',
    email: 'owner@example.test',
    emailVerified: true,
    role: 'user',
    twoFactorEnabled: true
  },
  impersonatedBy: null
} satisfies RouteSession
const connection = {
  id: 'sso_repair',
  protocol: 'oidc',
  domain: 'example.test',
  issuer: 'https://idp.example.test',
  enabled: true,
  requireSso: true,
  domainVerified: true,
  autoJoin: false,
  lastLoginTestedAt: '2026-09-07T00:00:00.000Z',
  defaultWorkspaceRole: 'member',
  clientIdLastFour: null,
  createdAt: '2026-01-01T00:00:00.000Z'
} satisfies SsoConnection

async function renderPage() {
  calls.activate.mockResolvedValue({
    workspaceId: 'wrk_live',
    expiresAt: '2026-09-07T01:00:00.000Z'
  })
  calls.load.mockResolvedValue([connection])
  calls.update.mockResolvedValue({ ...connection, requireSso: false })
  return renderWithRouter(
    <AccountSsoRepairPage
      session={session}
      workspaceSlug="live-lab"
      exceptionId="exception-1"
    />,
    { path: '/account', destinations: ['/sign-in'] }
  )
}

describe('AccountSsoRepairPage', () => {
  it('activates only after an explicit click', async () => {
    await renderPage()
    expect(calls.activate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Activate repair access' }))
    await waitFor(() =>
      expect(calls.activate).toHaveBeenCalledWith({
        data: { exceptionId: 'exception-1' }
      })
    )
  })

  it('shows a refused or expired grant as an activation error', async () => {
    calls.activate.mockRejectedValueOnce(new Error('expired'))
    await renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Activate repair access' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
  })

  it('requires confirmation before disabling the SSO requirement', async () => {
    await renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Activate repair access' }))
    await screen.findByText('example.test')
    fireEvent.click(screen.getByRole('button', { name: 'Disable SSO requirement' }))
    expect(calls.update).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm disable' }))
    await waitFor(() =>
      expect(calls.update).toHaveBeenCalledWith({
        data: { workspaceSlug: 'live-lab', providerId: 'sso_repair' }
      })
    )
  })
})
