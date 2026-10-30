import { fireEvent, screen, waitFor, within } from '@testing-library/dom'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { input } from '@/components/native-test-harness'
import { renderAccount } from './test-runtime'
import * as Directory from './directory'

const create = vi.hoisted(() => vi.fn())
vi.mock('@/lib/server/workspace-lifecycle', () => ({ createWorkspaceServerFn: create }))
const workspace = {
  id: 'wrk_new',
  slug: 'acme-corp',
  name: 'Acme Corp',
  planId: 'starter'
}
const membership = {
  workspace: { ...workspace, slug: 'starter-lab', name: 'Starter Lab' },
  memberCount: 3,
  notificationCount: 1
}
const assign = vi.fn()
beforeEach(() => {
  create.mockReset().mockResolvedValue(workspace)
  assign.mockReset()
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      href: 'http://localhost:3000/workspaces',
      origin: 'http://localhost:3000',
      pathname: '/workspaces',
      search: '',
      hash: '',
      assign
    }
  })
})
function render(directory: Directory.Flags['directory'] = []) {
  return renderAccount({
    directory: Directory.init({
      directory,
      purchase: null,
      purchasePage: false,
      validIntent: false
    }).model
  })
}
async function submit() {
  fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }))
}

describe('create-workspace-form migration', () => {
  it('submits the name and slug through its port', async () => {
    await render()
    await input(screen.getByLabelText('Workspace name'), 'Acme Corp')
    await submit()
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        data: { name: 'Acme Corp', slug: 'acme-corp' }
      })
    )
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/workspaces/acme-corp'))
  })

  it('keeps a slug the visitor edited by hand', async () => {
    await render()
    await input(screen.getByLabelText('Workspace name'), 'Something')
    await input(screen.getByLabelText('Workspace URL'), 'my-slug')
    await input(screen.getByLabelText('Workspace name'), 'Something Else')
    await submit()
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        data: { name: 'Something Else', slug: 'my-slug' }
      })
    )
  })

  it('refuses an invalid slug locally instead of calling the server', async () => {
    await render()
    await input(screen.getByLabelText('Workspace name'), 'Acme Corp')
    await input(screen.getByLabelText('Workspace URL'), 'Bad Slug!')
    await submit()
    await screen.findByText(/Use lowercase letters/)
    expect(create).not.toHaveBeenCalled()
  })

  it('shows the failure message when the port rejects', async () => {
    create.mockRejectedValue(new Error('slug already in use'))
    await render()
    await input(screen.getByLabelText('Workspace name'), 'Acme Corp')
    await submit()
    await screen.findByText('Failed to create workspace')
    expect(screen.queryByText('slug already in use')).toBeNull()
    expect(assign).not.toHaveBeenCalled()
  })
})
describe('workspaces.index migration', () => {
  it('exposes workspace links inside the directory list items', async () => {
    await render([membership])
    const list = screen.getByRole('list')
    expect(within(list).getAllByRole('listitem')).toHaveLength(1)
    expect(
      within(list)
        .getByRole('link', { name: /Starter Lab/ })
        .getAttribute('href')
    ).toBe('/workspaces/starter-lab')
  })

  it('offers creation from the header once the list is not empty', async () => {
    await render([membership])
    expect(screen.queryByLabelText('Workspace name')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'New workspace' }))
    const dialog = await screen.findByRole('dialog')
    await input(within(dialog).getByLabelText('Workspace name'), 'Acme Corp')
    await submit()
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        data: { name: 'Acme Corp', slug: 'acme-corp' }
      })
    )
  })

  it('keeps the form inline in the empty state, with no redundant action', async () => {
    await render()
    expect(screen.getByLabelText('Workspace name').closest('dialog')).toBeNull()
    expect(screen.queryByRole('button', { name: 'New workspace' })).toBeNull()
  })
})
