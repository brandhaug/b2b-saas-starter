import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { renderWithRouter } from '@/test/router-harness'
import { WorkspaceShell, type SignOut, type StopImpersonating } from './workspace-shell'

// The identity line reads the live Better Auth client, whose session hook
// fetches a relative URL no jsdom test can answer — stub it to the
// pre-hydration shape the shell must render anyway.
vi.mock('@/lib/auth-client', () => ({
  authClient: {
    useSession: () => ({ data: null, error: null, isPending: false })
  }
}))

// The shell's own `signOut` port, handed in as a prop. Everything else — the
// router, `Link`, `useRouter` — is the real TanStack implementation.
const signOut = vi.fn<SignOut>()
const stopImpersonating = vi.fn<StopImpersonating>()

/** What a gated route's `beforeLoad` puts on the context: the projected session. */
function sessionContext(impersonatedBy: string | null) {
  return {
    session: {
      user: {
        id: 'usr_dev',
        name: 'Product Engineer',
        email: 'engineer@example.com',
        emailVerified: true,
        role: 'user',
        twoFactorEnabled: false
      },
      impersonatedBy
    }
  }
}

async function renderShell(props?: {
  readonly workspaceSlug?: string | null
  readonly unreadCount?: number
  /** The viewer's role; defaults to a member. */
  readonly role?: 'owner' | 'admin' | 'member'
  /** The Better Auth system role of the signed-in user. */
  readonly systemRole?: string | null
  /** The route context the shell is rendered under; gated routes carry `session`. */
  readonly routeContext?: Record<string, unknown>
  /** Router-level context the shell reads back — the remembered workspace. */
  readonly routerContext?: Record<string, unknown>
}) {
  return renderWithRouter(
    <WorkspaceShell
      stopImpersonating={stopImpersonating}
      workspaceSlug={
        props?.workspaceSlug === undefined ? 'starter-lab' : props.workspaceSlug
      }
      viewer={props?.workspaceSlug === null ? null : { role: props?.role ?? 'member' }}
      {...(props?.systemRole === undefined ? {} : { systemRole: props.systemRole })}
      signOut={signOut}
      {...(props?.unreadCount === undefined ? {} : { unreadCount: props.unreadCount })}
    >
      <p>Dashboard content</p>
    </WorkspaceShell>,
    renderOptions(props?.routeContext, props?.routerContext)
  )
}

function renderOptions(
  routeContext: Record<string, unknown> | undefined,
  routerContext: Record<string, unknown> | undefined
) {
  return {
    path: '/workspaces/starter-lab',
    destinations: ['/sign-in', '/admin'],
    routeContext: routeContext ?? {},
    routerContext: routerContext ?? {}
  }
}

describe('WorkspaceShell', () => {
  beforeEach(() => {
    signOut.mockReset()
    signOut.mockResolvedValue(undefined)
    stopImpersonating.mockReset()
    stopImpersonating.mockResolvedValue(undefined)
  })

  it('shows no impersonation banner for an ordinary session or a public page', async () => {
    const { unmount } = await renderShell({ routeContext: sessionContext(null) })
    expect(screen.queryByRole('button', { name: 'Stop impersonating' })).toBeNull()
    unmount()
    await renderShell()
    expect(screen.queryByRole('button', { name: 'Stop impersonating' })).toBeNull()
  })

  it('shows who is impersonated on an impersonation session, and Stop returns to /admin', async () => {
    // The banner reads the route's `session` context (what `requireSession`
    // puts there), so the test renders under a route carrying one.
    const { router } = await renderShell({ routeContext: sessionContext('usr_admin') })
    const banner = screen.getByRole('status')
    expect(banner.textContent).toContain('Product Engineer')
    expect(banner.textContent).toContain('engineer@example.com')
    fireEvent.click(screen.getByRole('button', { name: 'Stop impersonating' }))
    await waitFor(() => expect(stopImpersonating).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(router.state.location.pathname).toBe('/admin'))
  })

  it('renders children (the page names itself via its own PageHeader)', async () => {
    await renderShell()
    screen.getByText('Dashboard content')
  })

  it('renders the user menu with sign out, and signs out through the port', async () => {
    const { router } = await renderShell()
    // The visit is remembered before it is forgotten.
    await waitFor(() =>
      expect(router.options.context.lastWorkspace).toEqual({
        slug: 'starter-lab',
        name: 'starter-lab'
      })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Open user menu' }))
    screen.getByText('Sign out')
    fireEvent.click(screen.getByText('Sign out'))
    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1))
    // Where the user ended up, read off the real router, rather than whether a
    // `navigate` double was called with the right argument.
    await waitFor(() => expect(router.state.location.pathname).toBe('/sign-in'))
    // Session memory does not outlive the session that earned it.
    await waitFor(() => expect(router.options.context.lastWorkspace).toBeNull())
  })

  it('threads the workspace slug into the nav links', async () => {
    await renderShell({ systemRole: 'admin' })
    const overview = screen.getByRole('link', { name: 'Overview' })
    expect(overview.getAttribute('href')).toBe('/workspaces/starter-lab')
    const settings = screen.getByRole('link', { name: 'General' })
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

  it('groups the nav Workspace, then Developer, then You — never inherited', async () => {
    // Owner: both Developer rows are permission-gated, and the group's label
    // only prints when one of its rows survives the filter.
    await renderShell({ role: 'owner', systemRole: 'admin' })
    const workspaceLabel = screen.getByText('Workspace')
    const developerLabel = screen.getByText('Developer')
    const youLabel = screen.getByText('You')
    // The old bug appended Account and System admin after the group loop,
    // under whatever label printed last. Now they follow their own.
    expect(
      workspaceLabel.compareDocumentPosition(developerLabel) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(
      developerLabel.compareDocumentPosition(youLabel) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    for (const link of [
      screen.getByRole('link', { name: 'Account' }),
      screen.getByRole('link', { name: 'System admin' })
    ]) {
      expect(
        youLabel.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy()
    }
    expect(screen.queryByText('Settings')).toBeNull()
  })

  it('keeps the sidebar column but not its workspace rows when no workspace is in play', async () => {
    await renderShell({ workspaceSlug: null, systemRole: 'admin' })
    expect(screen.queryByRole('link', { name: 'Overview' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'General' })).toBeNull()
    // The degenerate column stays honest: the picker's doorway stands in for
    // the switcher, the user rows render under their own label.
    screen.getByRole('link', { name: 'Choose a workspace…' })
    screen.getByText('You')
    screen.getByRole('link', { name: 'Account' })
    screen.getByRole('link', { name: 'System admin' })
  })

  it('anchors a system surface to the last visited workspace', async () => {
    await renderShell({
      workspaceSlug: null,
      systemRole: 'admin',
      routerContext: {
        lastWorkspace: { slug: 'starter-lab', name: 'Starter Lab' }
      }
    })
    const overview = screen.getByRole('link', { name: 'Overview' })
    expect(overview.getAttribute('href')).toBe('/workspaces/starter-lab')
    screen.getByRole('link', { name: 'General' })
    // The switcher names the remembered workspace even with no directory in
    // context to look it up in.
    screen.getByText('Starter Lab')
    screen.getByRole('link', { name: 'Account' })
    screen.getByRole('link', { name: 'System admin' })
  })

  it('remembers the visited workspace in router context', async () => {
    const { router } = await renderShell()
    // No directory in the harness, so the name falls back to the slug.
    await waitFor(() =>
      expect(router.options.context.lastWorkspace).toEqual({
        slug: 'starter-lab',
        name: 'starter-lab'
      })
    )
  })

  it('hides permission-gated entries from a member and shows them to an owner', async () => {
    // Same nav, same page: the gated rows ask `viewerCan` on the shell's one
    // `viewer` prop, not per-page booleans that flicker between routes.
    await renderShell({ role: 'member' })
    expect(screen.queryByRole('link', { name: 'API tokens' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Webhook endpoints' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Audit trail' })).toBeNull()
    screen.getByRole('link', { name: 'Overview' })

    const { unmount } = await renderShell({ role: 'owner' })
    screen.getByRole('link', { name: 'API tokens' })
    screen.getByRole('link', { name: 'Webhook endpoints' })
    screen.getByRole('link', { name: 'Audit trail' })
    unmount()
  })

  it('renders the unread badge as a link to the notifications route', async () => {
    const { unmount } = await renderShell({ unreadCount: 4 })
    const badge = screen.getByRole('link', { name: '4 unread notifications' })
    expect(badge.getAttribute('href')).toBe('/account/notifications')
    screen.getByText('4')
    unmount()
    await renderShell()
    expect(screen.queryByRole('link', { name: '4 unread notifications' })).toBeNull()
  })
})
