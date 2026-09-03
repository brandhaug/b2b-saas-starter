import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import { type WorkspaceSettingsPayload } from '@/lib/server/workspace-settings'
import { renderWithRouter } from '@/test/router-harness'
import {
  type DeleteWorkspace,
  type RenameWorkspace
} from '@/components/workspace-general-settings'
import { type SignOut } from '@/components/workspace-shell'
import { type RequestWorkspaceExport } from '@/components/workspace-export-panel'
import { WorkspaceSettingsPage } from './workspaces.$workspaceSlug.settings'

// The page takes its params and loader projection as props, so the test renders
// it directly under a real router: no route tree, no loader, and no mocked
// module. The server calls its children make arrive as ports.
const signOut = vi.fn<SignOut>()

const settingsSummary: WorkspaceSettingsPayload = {
  viewer: { role: 'owner' },
  workspaceName: 'Starter Lab',
  unreadCount: 2,
  exports: {
    availability: { available: true },
    exports: [
      {
        id: 'exp_1',
        status: 'ready',
        requestedAt: '2026-05-16T07:30:00.000Z',
        completedAt: '2026-05-16T07:30:05.000Z',
        expiresAt: '2026-05-23T07:30:05.000Z',
        sizeBytes: 4096,
        failureReason: null,
        downloadUrl:
          'http://localhost:8787/exports/exp_1/download?expires=1&signature=abc'
      }
    ]
  }
}

/**
 * What a `member` receives from the loader: settings carries only workspace
 * identity, so the payload is the same shape — only the viewer role differs.
 */
const memberSettings: WorkspaceSettingsPayload = {
  ...settingsSummary,
  viewer: { role: 'member' },
  exports: null
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

describe('WorkspaceSettingsPage data export', () => {
  it('offers the export button and the signed download link to an owner', async () => {
    await renderPage()
    screen.getByRole('heading', { name: 'Data export' })
    screen.getByRole('button', { name: 'Request export' })
    expect(
      screen.getByRole('link', { name: 'Download ZIP' }).getAttribute('href')
    ).toBe('http://localhost:8787/exports/exp_1/download?expires=1&signature=abc')
  })

  it('hides the whole export card from a non-owner', async () => {
    await renderPage(memberSettings)
    expect(screen.queryByRole('heading', { name: 'Data export' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Request export' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Download ZIP' })).toBeNull()
  })

  it('explains an unconfigured deployment instead of offering the button', async () => {
    await renderPage({
      ...settingsSummary,
      exports: {
        availability: {
          available: false,
          reason: 'Set WORKSPACE_EXPORT_BUCKET to enable.'
        },
        exports: []
      }
    })
    expect(screen.queryByRole('button', { name: 'Request export' })).toBeNull()
    screen.getByText('Set WORKSPACE_EXPORT_BUCKET to enable.')
    screen.getByText('No exports yet')
  })

  it('requests an export through the port', async () => {
    const requestExport = vi.fn<RequestWorkspaceExport>().mockResolvedValue({
      id: 'exp_2',
      status: 'pending',
      requestedAt: '2026-05-16T08:00:00.000Z',
      completedAt: null,
      expiresAt: null,
      sizeBytes: null,
      failureReason: null
    })
    await renderWithRouter(
      <WorkspaceSettingsPage
        workspaceSlug="starter-lab"
        data={settingsSummary}
        ports={{ signOut, requestExport }}
      />,
      { path: '/workspaces/starter-lab/settings', destinations: ['/sign-in'] }
    )
    await screen.findByRole('heading', { name: 'Workspace settings' })
    fireEvent.click(screen.getByRole('button', { name: 'Request export' }))
    await waitFor(() =>
      expect(requestExport).toHaveBeenCalledWith({
        data: { workspaceSlug: 'starter-lab' }
      })
    )
  })
})
