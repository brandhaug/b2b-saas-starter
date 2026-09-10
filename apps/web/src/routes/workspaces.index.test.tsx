import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import { renderWithRouter } from '@/test/router-harness'
import { type CreateWorkspace } from '@/components/create-workspace-form'
import { type WorkspaceDirectory } from '@/lib/workspace-directory'
import { WorkspacesPage } from './workspaces.index'

const user = { role: '', email: 'demo@example.test', emailVerified: true }

const membership: WorkspaceDirectory[number] = {
  workspace: {
    id: 'wrk_lab',
    slug: 'starter-lab',
    name: 'Starter Lab',
    planId: 'starter'
  },
  memberCount: 3,
  notificationCount: 1
}

async function renderPage(
  workspaces: WorkspaceDirectory,
  createWorkspace?: CreateWorkspace
) {
  return renderWithRouter(
    <WorkspacesPage
      workspaces={workspaces}
      user={user}
      onCreated={() => undefined}
      {...(createWorkspace === undefined ? {} : { createWorkspace })}
    />,
    { path: '/workspaces', destinations: ['/workspaces/starter-lab'] }
  )
}

describe('workspace picker', () => {
  it('names the list once: the page header, not a second panel heading', async () => {
    await renderPage([membership])
    expect(screen.getAllByRole('heading', { name: 'Your workspaces' })).toHaveLength(1)
  })

  it('offers creation from the header once the list is not empty', async () => {
    const createWorkspace = vi.fn<CreateWorkspace>().mockResolvedValue({
      id: 'wrk_new',
      slug: 'acme-corp',
      name: 'Acme Corp',
      planId: 'starter'
    })
    await renderPage([membership], createWorkspace)

    // Nothing to create with until the action is opened.
    expect(screen.queryByLabelText('Workspace name')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'New workspace' }))

    fireEvent.change(await screen.findByLabelText('Workspace name'), {
      target: { value: 'Acme Corp' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }))
    await waitFor(() =>
      expect(createWorkspace).toHaveBeenCalledWith({
        data: { name: 'Acme Corp', slug: 'acme-corp' }
      })
    )
  })

  it('keeps the form inline in the empty state, with no redundant action', async () => {
    await renderPage([])
    expect(screen.getByLabelText('Workspace name')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'New workspace' })).toBeNull()
  })
})
