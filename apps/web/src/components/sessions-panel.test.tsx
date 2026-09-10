import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { SessionsPanel } from './sessions-panel'
import { renderWithQueryClient } from '@/test/query-harness'
import { authClient } from '@/lib/auth-client'
import { m } from '@b2b-saas-starter/i18n/messages'

// The panel calls the client module directly, so its endpoints are doubles
// on the mocked module.
vi.mock('@/lib/auth-client', async () => {
  const { fakeAuthClient } = await import('@/test/fake-auth-client')
  return { authClient: fakeAuthClient() }
})

const listSessions = vi.mocked(authClient.listSessions)
const revokeSession = vi.mocked(authClient.revokeSession)
const revokeOtherSessions = vi.mocked(authClient.revokeOtherSessions)

type SessionRowInput = {
  readonly token: string
  readonly createdAt?: Date
  readonly expiresAt?: Date
  readonly ipAddress?: string | null | undefined
  readonly userAgent?: string | null | undefined
}

function session(overrides: Partial<SessionRowInput> & { token: string }) {
  return {
    token: overrides.token,
    createdAt: overrides.createdAt ?? new Date('2026-08-01T10:00:00Z'),
    expiresAt: overrides.expiresAt ?? new Date('2026-08-08T10:00:00Z'),
    ipAddress: overrides.ipAddress ?? null,
    userAgent: overrides.userAgent ?? null
  }
}

describe('SessionsPanel', () => {
  beforeEach(() => {
    listSessions.mockReset()
    revokeSession.mockReset()
    revokeOtherSessions.mockReset()
    revokeSession.mockResolvedValue({ error: null })
    revokeOtherSessions.mockResolvedValue({ error: null })
  })

  it('marks the current session and offers to sign out everywhere else', async () => {
    listSessions.mockResolvedValue({
      data: [
        session({ token: 'tok_current', userAgent: 'Mozilla/5.0 (Macintosh)' }),
        session({
          token: 'tok_other',
          userAgent: 'Mozilla/5.0 (iPhone)',
          ipAddress: '203.0.113.7'
        })
      ]
    })
    renderWithQueryClient(<SessionsPanel currentSessionToken="tok_current" />)

    await screen.findByText('· This device')
    expect(screen.getByText(/Mobile browser/)).not.toBeNull()
    expect(
      screen.getByRole('button', { name: m.auth_sign_out_everywhere() })
    ).not.toBeNull()
    // The current session has no per-row revoke button.
    expect(
      screen.queryByRole('button', { name: m.revoke_session_named({ name: 'Mac' }) })
    ).toBeNull()
    expect(
      screen.getByRole('button', {
        name: m.revoke_session_named({ name: m.mobile_browser() })
      })
    ).not.toBeNull()
  })

  it('revokes a single other session and refreshes the list', async () => {
    listSessions
      .mockResolvedValueOnce({
        data: [
          session({ token: 'tok_current' }),
          session({ token: 'tok_other', userAgent: 'Mozilla/5.0 (iPhone)' })
        ]
      })
      .mockResolvedValueOnce({ data: [session({ token: 'tok_current' })] })
    renderWithQueryClient(<SessionsPanel currentSessionToken="tok_current" />)

    fireEvent.click(
      await screen.findByRole('button', {
        name: m.revoke_session_named({ name: m.mobile_browser() })
      })
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke session' }))
    await waitFor(() =>
      expect(revokeSession).toHaveBeenCalledWith({ token: 'tok_other' })
    )
    await waitFor(() => expect(listSessions).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByText(/iPhone/)).toBeNull())
  })

  it('signs out everywhere else with one action', async () => {
    listSessions.mockResolvedValue({
      data: [
        session({ token: 'tok_current' }),
        session({ token: 'tok_a' }),
        session({ token: 'tok_b' })
      ]
    })
    renderWithQueryClient(<SessionsPanel currentSessionToken="tok_current" />)
    fireEvent.click(
      await screen.findByRole('button', { name: m.auth_sign_out_everywhere() })
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(revokeOtherSessions).toHaveBeenCalledTimes(1))
    expect(revokeSession).not.toHaveBeenCalled()
  })

  it('surfaces revocation failures', async () => {
    listSessions.mockResolvedValue({
      data: [session({ token: 'tok_current' }), session({ token: 'tok_other' })]
    })
    revokeOtherSessions.mockResolvedValue({
      // No code: the panel falls back to its own failure sentence rather
      // than rendering the raw message.
      error: {}
    })
    renderWithQueryClient(<SessionsPanel currentSessionToken="tok_current" />)
    fireEvent.click(
      await screen.findByRole('button', { name: m.auth_sign_out_everywhere() })
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(m.session_action_failed())
  })
})
