import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import { DeleteAccountPanel } from './delete-account-panel'
import { renderWithRouter } from '@/test/router-harness'
import {
  ACCOUNT_DELETION_BLOCKED_NAME,
  ACCOUNT_DELETION_REJECTED_NAME,
  describeDeleteFailure
} from '@/lib/delete-account-failure'
import { type AccountDeletionPlan } from '@b2b-saas-starter/capabilities/governance/account-lifecycle'

/**
 * The plan the panel receives is the loader's payload; the seed fixture keeps
 * `usr_demo` in a two-owner workspace, so the deletable state's plan below is
 * the shape `loadAccountPage` returns for them (one `leave` step). The blocked
 * state cannot come from the one-workspace seed fixture, so its plan is built
 * by hand here — the ownership rule that produces it is contract-tested in
 * `@b2b-saas-starter/capabilities`.
 */

const deletablePlan: AccountDeletionPlan = {
  steps: [
    {
      workspace: {
        id: 'wrk_starter',
        slug: 'starter-lab',
        name: 'Starter Lab',
        planId: 'team'
      },
      role: 'owner',
      action: 'leave'
    }
  ],
  canDelete: true
}

const blockedPlan: AccountDeletionPlan = {
  steps: [
    {
      workspace: {
        id: 'wrk_acme',
        slug: 'acme-lab',
        name: 'Acme Lab',
        planId: 'starter'
      },
      role: 'owner',
      action: 'blocked_sole_owner'
    }
  ],
  canDelete: false
}

describe('DeleteAccountPanel', () => {
  it('sends the password after the confirm step and leaves for /sign-in', async () => {
    const assign = vi.fn()
    Object.defineProperty(window, 'location', {
      value: { assign },
      writable: true
    })
    const deleteAccount = vi.fn().mockResolvedValue(deletablePlan)
    await renderWithRouter(
      <DeleteAccountPanel plan={deletablePlan} deleteAccount={deleteAccount} />,
      { path: '/account' }
    )
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'correct-horse-battery-staple' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete my account' }))
    await waitFor(() =>
      expect(deleteAccount).toHaveBeenCalledWith({
        password: 'correct-horse-battery-staple'
      })
    )
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/sign-in'))
  })

  it('shows the wrong-password refusal as copy, not a crash', async () => {
    const deleteAccount = vi.fn().mockRejectedValue(
      Object.assign(new Error('invalid_password'), {
        name: 'AccountDeletionRejected'
      })
    )
    await renderWithRouter(
      <DeleteAccountPanel plan={deletablePlan} deleteAccount={deleteAccount} />,
      { path: '/account' }
    )
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'nope' } })
    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete my account' }))
    await screen.findByText('That password is not correct.')
  })

  it('renders the blocked state as members-page links with no delete control', async () => {
    const deleteAccount = vi.fn()
    await renderWithRouter(
      <DeleteAccountPanel plan={blockedPlan} deleteAccount={deleteAccount} />,
      {
        path: '/account',
        destinations: ['/workspaces/acme-lab/members']
      }
    )
    screen.getByText(/Transfer ownership first/i)
    screen.getByRole('link', { name: 'Acme Lab' })
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
    ).toBe('Transfer ownership of your workspaces before deleting your account.')
    // An unknown rejection shows its own message; one without a useful name
    // or message gets the fallback sentence.
    expect(describeDeleteFailure(new Error('boom'))).toBe('boom')
    expect(describeDeleteFailure(undefined)).toBe('Could not delete the account')
  })
})
