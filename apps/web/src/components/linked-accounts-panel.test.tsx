import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  LinkedAccountsPanel,
  type ListLinkedAccounts,
  type UnlinkAccount
} from './linked-accounts-panel'
import { renderWithQueryClient } from '@/test/query-harness'

const listAccounts = vi.fn<ListLinkedAccounts>()
const unlinkAccount = vi.fn<UnlinkAccount>()

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
    renderWithQueryClient(
      <LinkedAccountsPanel listAccounts={listAccounts} unlinkAccount={unlinkAccount} />
    )

    expect(await screen.findByText('GitHub')).toBeDefined()
    expect(screen.getByText('email and password')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Unlink GitHub' })).toBeDefined()
    expect(
      screen.getByRole('button', { name: 'Unlink email and password' })
    ).toBeDefined()
  })

  it('refuses the only remaining sign-in method with a reason, not a control', async () => {
    listAccounts.mockResolvedValue({
      data: [linked({ id: 'acc_credential', providerId: 'credential' })]
    })
    renderWithQueryClient(
      <LinkedAccountsPanel listAccounts={listAccounts} unlinkAccount={unlinkAccount} />
    )

    await screen.findByText('email and password')
    expect(screen.queryByRole('button', { name: /Unlink/ })).toBeNull()
    expect(
      screen.getByText('Add another sign-in method before removing this one')
    ).toBeDefined()
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
    renderWithQueryClient(
      <LinkedAccountsPanel listAccounts={listAccounts} unlinkAccount={unlinkAccount} />
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Unlink GitHub' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Unlink' }))
    await waitFor(() => expect(unlinkAccount).toHaveBeenCalledTimes(1))
    expect(unlinkAccount).toHaveBeenCalledWith({ accountId: 'acc_github' })

    // The refreshed list no longer offers GitHub, and the remaining method is
    // protected by the one-method rule.
    await screen.findByText('Add another sign-in method before removing this one')
    expect(screen.queryByText('GitHub')).toBeNull()
  })
})
