import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

const adminFns = vi.hoisted(() => ({
  ban: vi.fn(),
  unban: vi.fn(),
  impersonate: vi.fn()
}))

vi.mock('@/lib/server/admin', () => ({
  banSystemUserServerFn: adminFns.ban,
  unbanSystemUserServerFn: adminFns.unban,
  impersonateUserServerFn: adminFns.impersonate
}))

import { BanUserAction } from './ban-user-action'
import { ImpersonateUserAction } from './impersonate-user-action'
import { renderWithRouter } from '@/test/router-harness'
import { type SystemUser } from '@/lib/server/admin'

const user: SystemUser = {
  id: 'usr_dev',
  name: 'Dev Member',
  email: 'dev@starter.local',
  role: 'user',
  banned: false
}

describe('admin confirmations', () => {
  beforeEach(() => {
    adminFns.ban.mockReset()
    adminFns.unban.mockReset()
    adminFns.impersonate.mockReset()
  })

  it('keeps a failed ban visible in its confirmation dialog', async () => {
    adminFns.ban.mockRejectedValue(new Error('request blocked'))
    await renderWithRouter(<BanUserAction user={user} />)

    fireEvent.click(screen.getByRole('button', { name: 'Ban dev@starter.local' }))
    fireEvent.click(screen.getByRole('button', { name: /^Ban$/ }))

    expect(await screen.findByText('Ban failed')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Cancel' })).not.toBeNull()
  })

  it('closes the ban confirmation after a successful request', async () => {
    adminFns.ban.mockResolvedValue(undefined)
    await renderWithRouter(<BanUserAction user={user} />)

    fireEvent.click(screen.getByRole('button', { name: 'Ban dev@starter.local' }))
    fireEvent.click(screen.getByRole('button', { name: /^Ban$/ }))

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
    })
  })

  it('keeps a failed impersonation visible in its confirmation dialog', async () => {
    adminFns.impersonate.mockRejectedValue(new Error('request blocked'))
    await renderWithRouter(<ImpersonateUserAction user={user} />)

    fireEvent.click(
      screen.getByRole('button', { name: /^Impersonate dev@starter\.local\?$/ })
    )
    fireEvent.click(screen.getByRole('button', { name: /^Impersonate$/ }))

    expect(await screen.findByText('Impersonation failed')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Cancel' })).not.toBeNull()
  })

  it('navigates away after a successful impersonation request', async () => {
    adminFns.impersonate.mockResolvedValue({ userId: user.id, expiresInSeconds: 900 })
    const rendered = await renderWithRouter(<ImpersonateUserAction user={user} />, {
      destinations: ['/workspaces']
    })

    fireEvent.click(
      screen.getByRole('button', { name: /^Impersonate dev@starter\.local\?$/ })
    )
    fireEvent.click(screen.getByRole('button', { name: /^Impersonate$/ }))

    await waitFor(() => {
      expect(rendered.router.state.location.pathname).toBe('/workspaces')
    })
  })
})
