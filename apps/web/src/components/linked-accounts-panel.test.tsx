import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { LinkedAccountsPanel } from './linked-accounts-panel'
import { renderWithQueryClient } from '@/test/query-harness'
import { authClient } from '@/lib/auth-client'
import { m } from '@b2b-saas-starter/i18n/messages'

// The panel calls the client module directly, so its endpoints are doubles
// on the mocked module.
vi.mock('@/lib/auth-client', async () => {
  const { fakeAuthClient } = await import('@/test/fake-auth-client')
  return { authClient: fakeAuthClient() }
})

const listAccounts = vi.mocked(authClient.listAccounts)
const unlinkAccount = vi.mocked(authClient.unlinkAccount)

function linked(overrides: {
  readonly id: string
  readonly providerId: string
  readonly createdAt?: Date
}) {
  return {
    id: overrides.id,
    providerId: overrides.providerId,
    createdAt: overrides.createdAt ?? new Date('2026-08-01T10:00:00Z')
  }
}

describe('LinkedAccountsPanel', () => {
  beforeEach(() => {
    listAccounts.mockReset()
    unlinkAccount.mockReset()
    unlinkAccount.mockResolvedValue({ error: null })
  })

  it('lists every sign-in method with a human label', async () => {
    listAccounts.mockResolvedValue({
      data: [
        linked({ id: 'acc_credential', providerId: 'credential' }),
        linked({ id: 'acc_github', providerId: 'github' })
      ]
    })
    renderWithQueryClient(<LinkedAccountsPanel />)

    expect(await screen.findByText('GitHub')).not.toBeNull()
    expect(screen.getByText('email and password')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Unlink GitHub' })).not.toBeNull()
    expect(
      screen.getByRole('button', { name: 'Unlink email and password' })
    ).not.toBeNull()
  })

  it('refuses the only remaining sign-in method with a reason, not a control', async () => {
    listAccounts.mockResolvedValue({
      data: [linked({ id: 'acc_credential', providerId: 'credential' })]
    })
    renderWithQueryClient(<LinkedAccountsPanel />)

    await screen.findByText('email and password')
    expect(screen.queryByRole('button', { name: /Unlink/ })).toBeNull()
    expect(screen.getByText(m.add_sign_in_method_before_removing())).not.toBeNull()
    expect(unlinkAccount).not.toHaveBeenCalled()
  })

  it('unlinks a provider through the confirmation and refreshes the list', async () => {
    listAccounts
      .mockResolvedValueOnce({
        data: [
          linked({ id: 'acc_credential', providerId: 'credential' }),
          linked({ id: 'acc_github', providerId: 'github' })
        ]
      })
      .mockResolvedValueOnce({
        data: [linked({ id: 'acc_credential', providerId: 'credential' })]
      })
    renderWithQueryClient(<LinkedAccountsPanel />)

    fireEvent.click(await screen.findByRole('button', { name: 'Unlink GitHub' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Unlink' }))
    await waitFor(() => expect(unlinkAccount).toHaveBeenCalledTimes(1))
    expect(unlinkAccount).toHaveBeenCalledWith({ accountId: 'acc_github' })

    // The refreshed list no longer offers GitHub, and the remaining method is
    // protected by the one-method rule.
    await screen.findByText(m.add_sign_in_method_before_removing())
    expect(screen.queryByText('GitHub')).toBeNull()
  })
})
