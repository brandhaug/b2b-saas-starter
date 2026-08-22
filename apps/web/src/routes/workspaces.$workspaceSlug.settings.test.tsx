import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { type WorkspaceSettingsPayload } from '@/lib/server/workspace-settings'
import { renderWithRouter } from '@/test/router-harness'
import { type CreateApiToken } from '@/components/api-token-form'
import {
  type DeleteWorkspace,
  type RenameWorkspace
} from '@/components/workspace-general-settings'
import { type SignOut } from '@/components/workspace-shell'
import { WorkspaceSettingsPage } from './workspaces.$workspaceSlug.settings'

// The page takes its params and loader projection as props, so the test renders
// it directly under a real router: no route tree, no loader, and no mocked
// module. The two server calls its children make arrive as ports.
const createToken = vi.fn<CreateApiToken>()
const signOut = vi.fn<SignOut>()

const settingsSummary: WorkspaceSettingsPayload = {
  viewer: { role: 'owner' },
  workspaceName: 'Starter Lab',
  apiTokenCount: 3,
  webhookCount: 1,
  unreadCount: 2,
  // The invitation panel renders from the same projection; an empty list is the
  // state a fresh workspace is in.
  invitations: []
}

/**
 * What a `member` receives from the loader: the segments the matrix denies are
 * `null`, because the server never read them (see loadWorkspaceSettings).
 */
const memberSettings: WorkspaceSettingsPayload = {
  ...settingsSummary,
  viewer: { role: 'member' },
  apiTokenCount: null,
  webhookCount: null,
  invitations: null
}

async function renderPage(data: WorkspaceSettingsPayload = settingsSummary) {
  const rendered = await renderWithRouter(
    <WorkspaceSettingsPage
      workspaceSlug="starter-lab"
      data={data}
      ports={{ createToken, signOut }}
    />,
    { path: '/workspaces/starter-lab/settings', destinations: ['/sign-in'] }
  )
  await screen.findByRole('heading', { name: 'Workspace settings' })
  return rendered
}

describe('WorkspaceSettingsPage', () => {
  it('renders the operational counts from the loader projection', async () => {
    await renderPage()
    screen.getByText(/3 workspace-scoped tokens are seeded/)
    screen.getByText(/1 endpoint is configured/)
    // Unread-notification badge in the shell header.
    screen.getByText('2')
  })

  it('renders the api token form scoped to the current workspace', async () => {
    await renderPage()
    screen.getByLabelText('Token name')
    screen.getByRole('button', { name: 'Create token' })
  })
})

describe('WorkspaceSettingsPage as a member', () => {
  it('does not render the api token section', async () => {
    await renderPage(memberSettings)
    expect(screen.queryByText('API tokens')).toBeNull()
    expect(screen.queryByLabelText('Token name')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Create token' })).toBeNull()
  })

  it('does not render the members or webhook sections', async () => {
    await renderPage(memberSettings)
    expect(screen.queryByText('Members')).toBeNull()
    expect(screen.queryByLabelText('Email')).toBeNull()
    expect(screen.queryByText('Outbound webhooks')).toBeNull()
  })
})

describe('WorkspaceSettingsPage lifecycle sections', () => {
  it('offers rename and delete to an owner', async () => {
    await renderPage()
    screen.getByLabelText('Workspace name')
    screen.getByRole('button', { name: 'Save name' })
    screen.getByRole('button', { name: 'Delete workspace' })
  })

  it('hides both from a member and says why', async () => {
    await renderPage(memberSettings)
    expect(screen.queryByRole('button', { name: 'Delete workspace' })).toBeNull()
    expect(screen.getByText(/cannot change or delete the workspace/)).toBeTruthy()
  })

  it('renames through the port and reports success', async () => {
    const rename = vi.fn<RenameWorkspace>().mockResolvedValue({ name: 'Renamed Lab' })
    await renderWithRouter(
      <WorkspaceSettingsPage
        workspaceSlug="starter-lab"
        data={settingsSummary}
        ports={{ createToken, signOut, renameWorkspace: rename }}
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
        ports={{ createToken, signOut, deleteWorkspace: remove }}
      />,
      { path: '/workspaces/starter-lab/settings', destinations: ['/sign-in'] }
    )
    await screen.findByRole('heading', { name: 'Workspace settings' })
    fireEvent.click(screen.getByRole('button', { name: 'Delete workspace' }))
    fireEvent.click(
      screen.getByRole('button', { name: 'Delete Starter Lab permanently' })
    )
    expect(remove).toHaveBeenCalledWith({ data: { workspaceSlug: 'starter-lab' } })
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/workspaces'))
  })
})
