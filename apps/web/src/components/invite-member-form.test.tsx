import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

import { InviteMemberForm } from './invite-member-form'
import { renderWithRouter } from '@/test/router-harness'

const sendInvitation = vi.hoisted(() => vi.fn())

vi.mock('@/lib/server/invitations', () => ({
  sendInvitationServerFn: sendInvitation
}))

describe('InviteMemberForm', () => {
  beforeEach(() => {
    sendInvitation.mockReset()
    sendInvitation.mockImplementation(({ data }: { data: { email: string } }) => {
      if (data.email === 'fail@example.com' && sendInvitation.mock.calls.length < 4) {
        return Promise.reject(new Error('Delivery unavailable'))
      }
      return Promise.resolve({
        invitation: {
          id: `inv_${data.email}`,
          email: data.email,
          role: 'member',
          status: 'pending'
        },
        status: 'logged',
        inviteUrl: `https://example.com/${data.email}`
      })
    })
  })

  it('sends addresses sequentially, reports partial failure, and retries only failures', async () => {
    await renderWithRouter(<InviteMemberForm workspaceSlug="starter-lab" />)
    fireEvent.change(screen.getByLabelText('Email addresses'), {
      target: { value: 'one@example.com\nfail@example.com\ntwo@example.com' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send invitation' }))

    await waitFor(() => expect(screen.getByText('2 sent, 1 failed')).not.toBeNull())
    expect(screen.getByText('Failed to send the invitation')).not.toBeNull()
    expect(sendInvitation.mock.calls.map(([call]) => call.data.email)).toEqual([
      'one@example.com',
      'fail@example.com',
      'two@example.com'
    ])

    fireEvent.click(screen.getByRole('radio', { name: 'admin' }))
    fireEvent.click(screen.getByRole('button', { name: 'Retry failed invitations' }))
    await waitFor(() => expect(screen.getByText('3 sent, 0 failed')).not.toBeNull())
    expect(sendInvitation).toHaveBeenCalledTimes(4)
    expect(sendInvitation.mock.calls[3]?.[0].data.email).toBe('fail@example.com')
    expect(sendInvitation.mock.calls[3]?.[0].data.role).toBe('member')
  })
})
