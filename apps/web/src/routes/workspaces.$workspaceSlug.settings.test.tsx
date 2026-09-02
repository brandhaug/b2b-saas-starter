import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import { type WorkspaceSettingsPayload } from '@/lib/server/workspace-settings'
import { renderWithRouter } from '@/test/router-harness'
import {
  type DeleteWorkspace,
  type RenameWorkspace
} from '@/components/workspace-general-settings'
import { type SignOut } from '@/components/workspace-shell'
import { WorkspaceSettingsPage } from './workspaces.$workspaceSlug.settings'

// The page takes its params and loader projection as props, so the test renders
// it directly under a real router: no route tree, no loader, and no mocked
// module. The server calls its children make arrive as ports.
const signOut = vi.fn<SignOut>()

const settingsSummary: WorkspaceSettingsPayload = {
  viewer: { role: 'owner' },
  workspaceName: 'Starter Lab',
  unreadCount: 2
}

/**
 * What a `member` receives from the loader: settings carries only workspace
 * identity, so the payload is the same shape — only the viewer role differs.
 */
const memberSettings: WorkspaceSettingsPayload = {
  ...settingsSummary,
  viewer: { role: 'member' }
}

async function renderPage(data: WorkspaceSettingsPayload = settingsSummary) {
  const rendered = await renderWithRouter(
    <WorkspaceSettingsPage
      workspaceSlug="starter-lab"
      data={data}
      ports={{ signOut }}
    />,
    { path: '/workspaces/starter-lab/settings', destinations: ['/sign-in'] }
  )
  await screen.findByRole('heading', { name: 'Workspace settings' })
  return rendered
}

describe('WorkspaceSettingsPage', () => {
  it('renders the rename and delete surface for an owner', async () => {
    await renderPage()
    screen.getByLabelText('Workspace name')
    screen.getByRole('button', { name: 'Save name' })
    screen.getByRole('button', { name: 'Delete workspace' })
    // Unread-notification badge in the shell header.
    screen.getByText('2')
    // The operational-settings card is gone: invitations live on the members
    // page and the token/webhook counts on their own pages.
    expect(screen.queryByText('Operational settings')).toBeNull()
    expect(screen.queryByRole('link', { name: 'API tokens page' })).toBeNull()
  })
})

describe('WorkspaceSettingsPage as a member', () => {
  it('hides both from a member and says why', async () => {
    await renderPage(memberSettings)
    expect(screen.queryByRole('button', { name: 'Delete workspace' })).toBeNull()
    expect(screen.getByText(/cannot change or delete the workspace/)).toBeTruthy()
  })
})

describe('WorkspaceSettingsPage lifecycle ports', () => {
  it('renames through the port and reports success', async () => {
    const rename = vi.fn<RenameWorkspace>().mockResolvedValue({ name: 'Renamed Lab' })
    await renderWithRouter(
      <WorkspaceSettingsPage
        workspaceSlug="starter-lab"
        data={settingsSummary}
        ports={{ signOut, renameWorkspace: rename }}
      />,
      { path: '/workspaces/starter-lab/settings', destinations: ['/sign-in'] }
    )
    await screen.findByRole('heading', { name: 'Workspace settings' })
    fireEvent.change(screen.getByLabelText('Workspace name'), {
      target: { value: 'Renamed Lab' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }))
    await waitFor(() =>
      expect(rename).toHaveBeenCalledWith({
        data: { workspaceSlug: 'starter-lab', name: 'Renamed Lab' }
      })
    )
    await screen.findByText(/renamed to “Renamed Lab”/)
  })

  it('deletes through the port after the confirm step', async () => {
    const remove = vi.fn<DeleteWorkspace>().mockResolvedValue(undefined)
    // `window.location.assign` is how the page lands on /workspaces; stub the
    // one property the page reads instead of replacing the Location object.
    const assign = vi.fn()
    Object.defineProperty(window, 'location', {
      value: { assign },
      writable: true
    })
    await renderWithRouter(
      <WorkspaceSettingsPage
        workspaceSlug="starter-lab"
        data={settingsSummary}
        ports={{ signOut, deleteWorkspace: remove }}
      />,
      { path: '/workspaces/starter-lab/settings', destinations: ['/sign-in'] }
    )
    await screen.findByRole('heading', { name: 'Workspace settings' })
    fireEvent.click(screen.getByRole('button', { name: 'Delete workspace' }))
    fireEvent.click(
      screen.getByRole('button', { name: 'Delete Starter Lab permanently' })
    )
    await waitFor(() =>
      expect(remove).toHaveBeenCalledWith({ data: { workspaceSlug: 'starter-lab' } })
    )
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/workspaces'))
  })
})
