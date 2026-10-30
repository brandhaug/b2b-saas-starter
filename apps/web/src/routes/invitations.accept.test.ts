import { type AcceptedInvitation } from '@b2b-saas-starter/capabilities/governance/workspace-invitations'
import { fireEvent, screen, waitFor } from '@testing-library/dom'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { renderNative } from '@/components/native-test-harness'
import { navigateDocument } from '@/lib/document-navigation'
import { m } from '@b2b-saas-starter/i18n/messages'
import {
  type InvitationPreview,
  acceptInvitationServerFn
} from '@/lib/server/invitations'

vi.mock('@/lib/server/invitations', () => ({ acceptInvitationServerFn: vi.fn() }))
vi.mock('@/lib/document-navigation', () => ({ navigateDocument: vi.fn() }))
type AcceptInvitation = typeof acceptInvitationServerFn
beforeEach(() => {
  vi.mocked(navigateDocument).mockReset()
})

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

async function renderPage(preview: InvitationPreview, accept: AcceptInvitation) {
  vi.mocked(acceptInvitationServerFn).mockReset().mockImplementation(accept)
  const rendered = await renderNative({ _tag: 'Invitation', flags: preview })
  if (preview.state === 'pending') {
    await waitFor(() => expect(acceptButton().hasAttribute('disabled')).toBe(false))
  }
  return rendered
}

function acceptButton(): HTMLElement {
  return screen.getByRole('button', { name: 'Accept invitation' })
}

describe('AcceptInvitationPage', () => {
  it('offers the addressee the workspace and the role', async () => {
    await renderPage(pending, vi.fn<AcceptInvitation>())
    await screen.findByRole('heading', { name: /Join Test Lab/ })
    screen.getByText(
      m.invitation_accept_description({
        workspace: 'Test Lab',
        role: m.shell_role_admin()
      })
    )
    expect(acceptButton().hasAttribute('disabled')).toBe(false)
  })

  it('sends the holder to the workspace once they join', async () => {
    const accept = vi.fn<AcceptInvitation>().mockResolvedValue(joined)
    await renderPage(pending, accept)
    fireEvent.click(acceptButton())
    await waitFor(() => {
      expect(navigateDocument).toHaveBeenCalledWith('/workspaces/test-lab')
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
    await renderPage(pending, accept)
    fireEvent.click(acceptButton())
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(m.accept_invitation_failed())
    expect(navigateDocument).not.toHaveBeenCalled()
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
      screen.getByRole('link', { name: m.go_to_workspaces() }).getAttribute('href')
    ).toBe('/workspaces')
    expect(accept).not.toHaveBeenCalled()
  })
})
