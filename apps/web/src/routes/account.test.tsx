import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import { AccountPage } from '@/components/account-page'
import { loadAccountPageHandler } from '@/lib/server/account.effects'
import { authClient } from '@/lib/auth-client'
import { fixtureSession } from '@/test/fixture-session'
import { type RouteSession } from '@/lib/server/auth'
import { renderWithRouter } from '@/test/router-harness'
import type * as AuthModule from '@/lib/server/auth'

// The handler's session gate, answered with the seed demo owner.
vi.mock('@/lib/server/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof AuthModule>()),
  requireRequestSession: async () => fixtureSession({ userId: 'usr_demo' })
}))

// The sessions panel calls the client module directly, so its endpoints are
// doubles on the mocked module.
vi.mock('@/lib/auth-client', async () => {
  const { fakeAuthClient } = await import('@/test/fake-auth-client')
  return { authClient: fakeAuthClient() }
})

/**
 * The payload comes from the real loader handler (`loadAccountPageHandler`)
 * against the Seed layer rather than a hand-written fixture, so a payload
 * shape change cannot pass here while failing in the app. The seed fixture
 * has `usr_demo` as one of two owners of `starter-lab`, so their plan is a
 * `leave` — the deletable state.
 *
 * The sessions list itself is this route test's focus: the panel calls the
 * Better Auth client directly, so `@/lib/auth-client` is doubled with
 * `fakeAuthClient()` and the endpoints are driven through `vi.mocked` — the
 * same seam `sessions-panel.test.tsx` drives for the panel alone.
 */
const listSessions = vi.mocked(authClient.listSessions)
const revokeSession = vi.mocked(authClient.revokeSession)

function routeSession(
  overrides: Partial<Pick<RouteSession, 'impersonatedBy'>> = {}
): RouteSession {
  return {
    user: {
      id: 'usr_demo',
      name: 'Demo Admin',
      email: 'demo@starter.local',
      emailVerified: true,
      role: 'admin',
      twoFactorEnabled: false
    },
    impersonatedBy: null,
    ...overrides
  }
}

function browserSession(overrides: {
  token: string
  userAgent?: string
  ipAddress?: string
}) {
  return {
    token: overrides.token,
    createdAt: new Date('2026-08-01T10:00:00Z'),
    expiresAt: new Date('2026-08-08T10:00:00Z'),
    ipAddress: overrides.ipAddress ?? null,
    userAgent: overrides.userAgent ?? null
  }
}

describe('/account', () => {
  it('loads the real plan for a seed member: deletable, leave step', async () => {
    const { deletionPlan } = await loadAccountPageHandler()
    expect(deletionPlan.canDelete).toBe(true)
    expect(deletionPlan.steps).toHaveLength(1)
    expect(deletionPlan.steps[0]?.workspace.slug).toBe('starter-lab')
    expect(deletionPlan.steps[0]?.action).toBe('leave')
  })

  it('lists sessions with the current one marked and the others revocable', async () => {
    listSessions.mockReset()
    listSessions.mockResolvedValue({
      data: [
        browserSession({ token: 'tok_current', userAgent: 'Mozilla/5.0 (Macintosh)' }),
        browserSession({
          token: 'tok_other',
          userAgent: 'Mozilla/5.0 (iPhone)',
          ipAddress: '203.0.113.7'
        })
      ]
    })
    const payload = await loadAccountPageHandler()
    await renderWithRouter(
      <AccountPage
        session={routeSession()}
        deletionPlan={payload.deletionPlan}
        currentSessionToken="tok_current"
      />,
      { path: '/account' }
    )
    // The sessions list, from the ports: two devices, one marked current.
    await screen.findByText('Mac')
    screen.getByText('· This device')
    screen.getByText('Mobile browser')
    screen.getByText('Sign out everywhere else')
    // The other session is the only revocable one.
    const revoke = screen.getByRole('button', {
      name: 'Revoke session on Mobile browser'
    })
    fireEvent.click(revoke)
    fireEvent.click(screen.getByRole('button', { name: 'Revoke session' }))
    await waitFor(() =>
      expect(revokeSession).toHaveBeenCalledWith({ token: 'tok_other' })
    )
  })

  it('shows the deletion consequences for an ordinary session', async () => {
    listSessions.mockReset()
    listSessions.mockResolvedValue({ data: [browserSession({ token: 'tok_current' })] })
    const payload = await loadAccountPageHandler()
    await renderWithRouter(
      <AccountPage
        session={routeSession()}
        deletionPlan={payload.deletionPlan}
        currentSessionToken="tok_current"
      />,
      { path: '/account' }
    )
    await screen.findByText(/You leave workspace Starter Lab\. Other owners keep it\./)
    screen.getByRole('button', { name: 'Delete account' })
    // With one session there is nothing to sign out elsewhere.
    await waitFor(() => {
      expect(screen.queryByText('Sign out everywhere else')).toBeNull()
    })
  })

  it('hides the account controls from an impersonation session', async () => {
    listSessions.mockReset()
    listSessions.mockResolvedValue({ data: [browserSession({ token: 'tok_current' })] })
    const payload = await loadAccountPageHandler()
    await renderWithRouter(
      <AccountPage
        session={routeSession({ impersonatedBy: 'usr_admin' })}
        deletionPlan={payload.deletionPlan}
        currentSessionToken="tok_current"
      />,
      { path: '/account' }
    )
    await screen.findByText(
      'The account cannot be deleted while impersonating this user.'
    )
    screen.getByText('Personal data cannot be exported while impersonating this user.')
    expect(screen.queryByRole('button', { name: 'Prepare personal data' })).toBeNull()
    expect(screen.queryByLabelText('Password')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete account' })).toBeNull()
  })

  it('keeps the full sidebar anchored to the last visited workspace', async () => {
    listSessions.mockReset()
    listSessions.mockResolvedValue({ data: [browserSession({ token: 'tok_current' })] })
    const payload = await loadAccountPageHandler()
    await renderWithRouter(
      <AccountPage
        session={routeSession()}
        deletionPlan={payload.deletionPlan}
        currentSessionToken="tok_current"
      />,
      {
        path: '/account',
        routerContext: { lastWorkspace: { slug: 'starter-lab', name: 'Starter Lab' } }
      }
    )
    // /account is not a workspace surface, but the column still carries the
    // remembered workspace's nav beside the user rows.
    const overview = screen.getByRole('link', { name: 'Overview' })
    expect(overview.getAttribute('href')).toBe('/workspaces/starter-lab')
    screen.getByText('Starter Lab')
    screen.getByRole('link', { name: 'Account' })
    screen.getByRole('link', { name: 'System admin' })
  })

  it('falls back to the picker doorway when no workspace has been visited', async () => {
    // The SSR truth for a direct /account landing: nothing remembered yet, so
    // the column keeps its shape and points at the picker.
    listSessions.mockReset()
    listSessions.mockResolvedValue({ data: [browserSession({ token: 'tok_current' })] })
    const payload = await loadAccountPageHandler()
    await renderWithRouter(
      <AccountPage
        session={routeSession()}
        deletionPlan={payload.deletionPlan}
        currentSessionToken="tok_current"
      />,
      { path: '/account' }
    )
    screen.getByRole('link', { name: 'Choose a workspace…' })
    expect(screen.queryByRole('link', { name: 'Overview' })).toBeNull()
    screen.getByText('You')
  })
})
