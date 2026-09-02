import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { renderWithRouter } from '@/test/router-harness'
import { WorkspaceShell, type SignOut } from './workspace-shell'

// The shell's own `signOut` port, handed in as a prop. Everything else — the
// router, `Link`, `useRouter` — is the real TanStack implementation.
const signOut = vi.fn<SignOut>()

async function renderShell(props?: {
  readonly workspaceSlug?: string | null
  readonly unreadCount?: number
  /** The viewer's role; defaults to a member. */
  readonly role?: 'owner' | 'admin' | 'member'
  /** The Better Auth system role of the signed-in user. */
  readonly systemRole?: string | null
}) {
  return renderWithRouter(
    <WorkspaceShell
      workspaceSlug={
        props?.workspaceSlug === undefined ? 'starter-lab' : props.workspaceSlug
      }
      viewer={props?.workspaceSlug === null ? null : { role: props?.role ?? 'member' }}
      {...(props?.systemRole === undefined ? {} : { systemRole: props.systemRole })}
      title="Starter Lab"
      description="Reference workspace"
      signOut={signOut}
      {...(props?.unreadCount === undefined ? {} : { unreadCount: props.unreadCount })}
    >
      <p>Dashboard content</p>
    </WorkspaceShell>,
    { path: '/workspaces/starter-lab', destinations: ['/sign-in'] }
  )
}

describe('WorkspaceShell', () => {
  beforeEach(() => {
    signOut.mockReset()
    signOut.mockResolvedValue(undefined)
  })

  it('renders title, description, and children', async () => {
    await renderShell()
    screen.getByRole('heading', { name: 'Starter Lab' })
    screen.getByText('Reference workspace')
    screen.getByText('Dashboard content')
  })

  it('threads the workspace slug into the nav links', async () => {
    await renderShell({ systemRole: 'admin' })
    const overview = screen.getByRole('link', { name: 'Overview' })
    expect(overview.getAttribute('href')).toBe('/workspaces/starter-lab')
    const settings = screen.getByRole('link', { name: 'Settings' })
    expect(settings.getAttribute('href')).toBe('/workspaces/starter-lab/settings')
    screen.getByRole('link', { name: 'System admin' })
  })

  it('shows the System admin link only to a system admin', async () => {
    // Every other role meets a 404 behind /admin, so the link is a dead end
    // for them — presentation mirrors the route's `requireAdmin` gate.
    await renderShell({ systemRole: 'user' })
    expect(screen.queryByRole('link', { name: 'System admin' })).toBeNull()
    await renderShell()
    expect(screen.queryByRole('link', { name: 'System admin' })).toBeNull()
  })

  it('hides workspace links on system surfaces without borrowing a workspace', async () => {
    await renderShell({ workspaceSlug: null, systemRole: 'admin' })
    expect(screen.queryByRole('link', { name: 'Overview' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Settings' })).toBeNull()
    screen.getByRole('link', { name: 'System admin' })
  })

  it('hides permission-gated entries from a member and shows them to an owner', async () => {
    // Same nav, same page: the gated rows ask `viewerCan` on the shell's one
    // `viewer` prop, not per-page booleans that flicker between routes.
    await renderShell({ role: 'member' })
    expect(screen.queryByRole('link', { name: 'API tokens' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Webhooks' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Audit trail' })).toBeNull()
    screen.getByRole('link', { name: 'Overview' })

    const { unmount } = await renderShell({ role: 'owner' })
    screen.getByRole('link', { name: 'API tokens' })
    screen.getByRole('link', { name: 'Webhooks' })
    screen.getByRole('link', { name: 'Audit trail' })
    unmount()
  })

  it('renders the unread badge only when a count is provided', async () => {
    const { unmount } = await renderShell({ unreadCount: 4 })
    screen.getByText('4')
    unmount()
    await renderShell()
    expect(screen.queryByText('4')).toBeNull()
  })

  it('signs out and navigates to /sign-in', async () => {
    const { router } = await renderShell()
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1))
    // Where the user ended up, read off the real router, rather than whether a
    // `navigate` double was called with the right argument.
    await waitFor(() => expect(router.state.location.pathname).toBe('/sign-in'))
  })
})
