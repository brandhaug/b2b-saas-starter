import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  signOut: vi.fn()
}))

vi.mock('@tanstack/react-router', async () => {
  const { routerMock } = await import('@/test/router-mock')
  return routerMock({
    useRouter: () => ({ navigate: mocks.navigate }),
    useNavigate: () => mocks.navigate
  })
})

vi.mock('@/lib/auth-client', () => ({
  authClient: {
    signOut: () => mocks.signOut()
  }
}))

import { WorkspaceShell } from './workspace-shell'

function renderShell(props?: {
  readonly workspaceSlug?: string | null
  readonly unreadCount?: number
}) {
  return render(
    <WorkspaceShell
      workspaceSlug={
        props?.workspaceSlug === undefined ? 'starter-lab' : props.workspaceSlug
      }
      title="Starter Lab"
      description="Reference workspace"
      {...(props?.unreadCount === undefined ? {} : { unreadCount: props.unreadCount })}
    >
      <p>Dashboard content</p>
    </WorkspaceShell>
  )
}

describe('WorkspaceShell', () => {
  beforeEach(() => {
    mocks.navigate.mockReset()
    mocks.signOut.mockReset()
    mocks.signOut.mockResolvedValue(undefined)
  })

  it('renders title, description, and children', () => {
    renderShell()
    screen.getByRole('heading', { name: 'Starter Lab' })
    screen.getByText('Reference workspace')
    screen.getByText('Dashboard content')
  })

  it('threads the workspace slug into the nav links', () => {
    renderShell()
    const overview = screen.getByRole('link', { name: 'Overview' })
    expect(overview.getAttribute('href')).toBe('/workspaces/starter-lab')
    const settings = screen.getByRole('link', { name: 'Settings' })
    expect(settings.getAttribute('href')).toBe('/workspaces/starter-lab/settings')
    screen.getByRole('link', { name: 'System admin' })
  })

  it('hides workspace links on system surfaces without borrowing a workspace', () => {
    renderShell({ workspaceSlug: null })
    expect(screen.queryByRole('link', { name: 'Overview' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Settings' })).toBeNull()
    screen.getByRole('link', { name: 'System admin' })
  })

  it('renders the unread badge only when a count is provided', () => {
    const { unmount } = renderShell({ unreadCount: 4 })
    screen.getByText('4')
    unmount()
    renderShell()
    expect(screen.queryByText('4')).toBeNull()
  })

  it('signs out and navigates to /sign-in', async () => {
    renderShell()
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(mocks.signOut).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith({ to: '/sign-in' }))
  })
})
