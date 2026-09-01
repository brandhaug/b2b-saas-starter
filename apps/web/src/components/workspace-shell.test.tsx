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
}) {
  return renderWithRouter(
    <WorkspaceShell
      workspaceSlug={
        props?.workspaceSlug === undefined ? 'starter-lab' : props.workspaceSlug
      }
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
    await renderShell()
    const overview = screen.getByRole('link', { name: 'Overview' })
    expect(overview.getAttribute('href')).toBe('/workspaces/starter-lab')
    const settings = screen.getByRole('link', { name: 'Settings' })
    expect(settings.getAttribute('href')).toBe('/workspaces/starter-lab/settings')
    screen.getByRole('link', { name: 'System admin' })
  })

  it('hides workspace links on system surfaces without borrowing a workspace', async () => {
    await renderShell({ workspaceSlug: null })
    expect(screen.queryByRole('link', { name: 'Overview' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Settings' })).toBeNull()
    screen.getByRole('link', { name: 'System admin' })
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
