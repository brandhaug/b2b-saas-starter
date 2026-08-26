import { type AcceptedInvitation } from '@b2b-saas-starter/capabilities/governance/workspace-invitations'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithRouter } from '@/test/router-harness'
import { type InvitationPreview } from '@/lib/server/invitations'
import { AcceptInvitationPage, type AcceptInvitation } from './invitations.accept'

/**
 * The invite link's landing page, rendered directly with the accept call as a
 * port. Both of its states matter: a pending invitation is the only one allowed
 * to name the workspace, and every other outcome has to look identical.
 */
const pending: InvitationPreview = {
  state: 'pending',
  invitationId: 'inv_seeded',
  workspaceName: 'Test Lab',
  workspaceSlug: 'test-lab',
  role: 'admin'
}

const joined: AcceptedInvitation = {
  workspaceSlug: 'test-lab',
  workspaceName: 'Test Lab',
  role: 'admin'
}

function renderPage(preview: InvitationPreview, accept: AcceptInvitation) {
  return renderWithRouter(<AcceptInvitationPage preview={preview} accept={accept} />, {
    path: '/invitations/accept',
    destinations: ['/workspaces', '/workspaces/$workspaceSlug']
  })
}

function acceptButton(): HTMLElement {
  return screen.getByRole('button', { name: 'Accept invitation' })
}

describe('AcceptInvitationPage', () => {
  it('offers the addressee the workspace and the role', async () => {
    await renderPage(pending, vi.fn<AcceptInvitation>())
    await screen.findByRole('heading', { name: /Join Test Lab/ })
    screen.getByText('admin')
    expect(acceptButton().hasAttribute('disabled')).toBe(false)
  })

  it('sends the holder to the workspace once they join', async () => {
    const accept = vi.fn<AcceptInvitation>().mockResolvedValue(joined)
    const { router } = await renderPage(pending, accept)
    fireEvent.click(acceptButton())
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/workspaces/test-lab')
    })
    expect(accept).toHaveBeenCalledWith({ data: { invitationId: 'inv_seeded' } })
  })

  it('shows the refusal and stays put when the accept fails', async () => {
    // What a `MembershipChangeRejected` looks like once it has crossed the
    // server-function boundary: name and message, nothing else.
    const rejected = Object.assign(new Error('invitation_expired'), {
      name: 'MembershipChangeRejected'
    })
    const accept = vi.fn<AcceptInvitation>().mockRejectedValue(rejected)
    const { router } = await renderPage(pending, accept)
    fireEvent.click(acceptButton())
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('invitation_expired')
    expect(router.state.location.pathname).toBe('/invitations/accept')
    // Re-enabled, so a refusal the inviter can fix is retryable.
    expect(acceptButton().hasAttribute('disabled')).toBe(false)
  })

  it('names nothing at all for an unusable invitation', async () => {
    const accept = vi.fn<AcceptInvitation>()
    await renderPage({ state: 'unavailable' }, accept)
    await screen.findByRole('heading', { name: 'This invitation cannot be used' })
    // The opaque state must not disclose which workspace the id belonged to,
    // or whether it belonged to one at all.
    expect(screen.queryByText(/Test Lab/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Accept invitation' })).toBeNull()
    expect(
      screen.getByRole('link', { name: 'Go to your workspaces' }).getAttribute('href')
    ).toBe('/workspaces')
    expect(accept).not.toHaveBeenCalled()
  })
})
