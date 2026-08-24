import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SessionsPanel,
  type ListSessions,
  type RevokeOtherSessions,
  type RevokeSession
} from './sessions-panel'

const listSessions = vi.fn<ListSessions>()
const revokeSession = vi.fn<RevokeSession>()
const revokeOtherSessions = vi.fn<RevokeOtherSessions>()

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
    render(
      <SessionsPanel
        currentSessionToken="tok_current"
        listSessions={listSessions}
        revokeSession={revokeSession}
        revokeOtherSessions={revokeOtherSessions}
      />
    )

    await screen.findByText('· This device')
    expect(screen.getByText(/Mobile browser/)).toBeDefined()
    expect(
      screen.getByRole('button', { name: 'Sign out everywhere else' })
    ).toBeDefined()
    // The current session has no per-row revoke button.
    expect(screen.queryByRole('button', { name: 'Revoke' })).not.toBeNull()
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
    render(
      <SessionsPanel
        currentSessionToken="tok_current"
        listSessions={listSessions}
        revokeSession={revokeSession}
        revokeOtherSessions={revokeOtherSessions}
      />
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Revoke' }))
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
    render(
      <SessionsPanel
        currentSessionToken="tok_current"
        listSessions={listSessions}
        revokeSession={revokeSession}
        revokeOtherSessions={revokeOtherSessions}
      />
    )
    fireEvent.click(
      await screen.findByRole('button', { name: 'Sign out everywhere else' })
    )
    await waitFor(() => expect(revokeOtherSessions).toHaveBeenCalledTimes(1))
    expect(revokeSession).not.toHaveBeenCalled()
  })

  it('surfaces revocation failures', async () => {
    listSessions.mockResolvedValue({
      data: [session({ token: 'tok_current' }), session({ token: 'tok_other' })]
    })
    revokeOtherSessions.mockResolvedValue({
      error: { message: 'Could not revoke sessions' }
    })
    render(
      <SessionsPanel
        currentSessionToken="tok_current"
        listSessions={listSessions}
        revokeSession={revokeSession}
        revokeOtherSessions={revokeOtherSessions}
      />
    )
    fireEvent.click(
      await screen.findByRole('button', { name: 'Sign out everywhere else' })
    )
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Could not revoke sessions')
  })
})
