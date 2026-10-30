// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from '@testing-library/dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { demoFixtures } from '@/lib/demo-fixtures'
import * as Settings from '@/lib/server/workspace-settings'
import * as Lifecycle from '@/lib/server/workspace-lifecycle'
import * as Exports from '@/lib/server/workspace-exports'
import { input } from '@/components/native-test-harness'
import { renderWorkspace } from './test-harness'

const archive = {
  id: 'exp_1',
  status: 'ready' as const,
  requestedAt: '2026-05-16T07:30:00.000Z',
  completedAt: '2026-05-16T07:30:05.000Z',
  expiresAt: '2026-05-23T07:30:05.000Z',
  sizeBytes: 4096,
  failureReason: null
}
const data = {
  ...demoFixtures.settings,
  exports: { availability: { available: true as const }, exports: [archive] }
}
beforeEach(() => {
  vi.spyOn(Settings, 'loadWorkspaceSettingsServerFn').mockResolvedValue(data)
})
afterEach(() => vi.unstubAllGlobals())
function renderPage(value: Settings.WorkspaceSettingsPayload = data, tab = 'general') {
  return renderWorkspace(
    { _tag: 'settings', data: value },
    { url: `/workspaces/starter-lab/settings?tab=${tab}` }
  )
}
describe('workspace settings preserved behaviors', () => {
  it('renders the rename and delete surface for an owner', async () => {
    await renderPage()
    expect(screen.getByLabelText('Workspace name')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Save name' })).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Delete workspace' })).not.toBeNull()
    expect(screen.queryByText('Operational settings')).toBeNull()
    expect(screen.queryByRole('link', { name: 'API tokens page' })).toBeNull()
  })

  it('hides both from a member and says why', async () => {
    await renderPage({
      ...data,
      viewer: { role: 'member' },
      ssoConnections: null,
      exports: null
    })
    expect(screen.queryByRole('button', { name: 'Delete workspace' })).toBeNull()
    expect(screen.getByText(/cannot change or delete the workspace/)).not.toBeNull()
  })

  it('renames through the port and reports success', async () => {
    const rename = vi
      .spyOn(Lifecycle, 'renameWorkspaceServerFn')
      .mockImplementation(async ({ data: request }) => ({
        id: 'ws_demo',
        slug: 'starter-lab',
        planId: 'team',
        name: request.name
      }))
    vi.mocked(Settings.loadWorkspaceSettingsServerFn).mockResolvedValueOnce({
      ...data,
      workspaceName: 'Renamed Lab'
    })
    await renderPage()
    await input(screen.getByLabelText('Workspace name'), 'Renamed Lab')
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }))
    await waitFor(() =>
      expect(rename).toHaveBeenCalledWith({
        data: { workspaceSlug: 'starter-lab', name: 'Renamed Lab' }
      })
    )
    expect(await screen.findByText(/Workspace renamed to “Renamed Lab”/)).not.toBeNull()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save name' })).toHaveProperty(
        'disabled',
        true
      )
    )
    await input(screen.getByLabelText('Workspace name'), data.workspaceName)
    expect(screen.getByRole('button', { name: 'Save name' })).toHaveProperty(
      'disabled',
      false
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }))
    await waitFor(() => expect(rename).toHaveBeenCalledTimes(2))
    expect(rename).toHaveBeenLastCalledWith({
      data: { workspaceSlug: 'starter-lab', name: data.workspaceName }
    })
  })

  it('deletes through the port after typing the slug to arm the dialog', async () => {
    const assign = vi.fn()
    vi.stubGlobal('location', {
      href: window.location.href,
      origin: window.location.origin,
      assign
    })
    const remove = vi
      .spyOn(Lifecycle, 'deleteWorkspaceServerFn')
      .mockResolvedValue(undefined)
    await renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Delete workspace' }))
    const confirm = await screen.findByRole('button', {
      name: 'Delete this workspace permanently'
    })
    expect(confirm).toHaveProperty('disabled', true)
    await input(screen.getByLabelText('Type starter-lab to confirm'), 'starter-lab')
    expect(confirm).toHaveProperty('disabled', false)
    fireEvent.click(confirm)
    await waitFor(() =>
      expect(remove).toHaveBeenCalledWith({ data: { workspaceSlug: 'starter-lab' } })
    )
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/workspaces'))
  })

  it('offers explicit export and download actions to an owner', async () => {
    await renderPage(data, 'exports')
    expect(screen.getByRole('button', { name: 'Request export' })).not.toBeNull()
    expect(
      screen.getByRole('button', { name: 'Download archive' }).getAttribute('href')
    ).toBeNull()
  })

  it('hides the whole export card from a non-owner', async () => {
    await renderPage({
      ...data,
      viewer: { role: 'member' },
      ssoConnections: null,
      exports: null
    })
    expect(screen.queryByRole('heading', { name: 'Data export' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Request export' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Download archive' })).toBeNull()
  })

  it('explains an unconfigured deployment instead of offering the button', async () => {
    await renderPage(
      {
        ...data,
        exports: {
          availability: {
            available: false,
            reason: 'Set WORKSPACE_EXPORTS_ENABLED to enable.'
          },
          exports: []
        }
      },
      'exports'
    )
    expect(screen.queryByRole('button', { name: 'Request export' })).toBeNull()
    expect(screen.getByText('Set WORKSPACE_EXPORTS_ENABLED to enable.')).not.toBeNull()
    expect(screen.getByText('No exports yet')).not.toBeNull()
  })

  it('requests an export through the port', async () => {
    const request = vi
      .spyOn(Exports, 'requestWorkspaceExportServerFn')
      .mockResolvedValue({
        ...archive,
        id: 'exp_2',
        status: 'pending',
        completedAt: null,
        expiresAt: null,
        sizeBytes: null
      })
    await renderPage(data, 'exports')
    fireEvent.click(screen.getByRole('button', { name: 'Request export' }))
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith({ data: { workspaceSlug: 'starter-lab' } })
    )
  })
})
