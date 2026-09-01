import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import { CreateWorkspaceForm, type CreateWorkspace } from './create-workspace-form'
import { renderWithRouter } from '@/test/router-harness'

const userId = 'usr_tester'

const createdWorkspace = {
  id: 'wrk_new',
  slug: 'acme-corp',
  name: 'Acme Corp',
  planId: 'starter'
}

async function renderForm(createWorkspace: CreateWorkspace) {
  return renderWithRouter(
    <CreateWorkspaceForm userId={userId} createWorkspace={createWorkspace} />
  )
}

describe('CreateWorkspaceForm', () => {
  it('submits the name, slug, and user id through its port', async () => {
    const createWorkspace = vi.fn<CreateWorkspace>().mockResolvedValue(createdWorkspace)
    await renderForm(createWorkspace)

    fireEvent.change(screen.getByLabelText('Workspace name'), {
      target: { value: 'Acme Corp' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }))

    // The slug mirrored the typed name without the visitor touching that field.
    await waitFor(() =>
      expect(createWorkspace).toHaveBeenCalledWith({
        data: { name: 'Acme Corp', slug: 'acme-corp', userId }
      })
    )
  })

  it('keeps a slug the visitor edited by hand', async () => {
    const createWorkspace = vi.fn<CreateWorkspace>().mockResolvedValue({
      ...createdWorkspace,
      name: 'Something Else',
      slug: 'my-slug'
    })
    await renderForm(createWorkspace)

    fireEvent.change(screen.getByLabelText('Workspace name'), {
      target: { value: 'Something' }
    })
    fireEvent.change(screen.getByLabelText('Workspace URL'), {
      target: { value: 'my-slug' }
    })
    fireEvent.change(screen.getByLabelText('Workspace name'), {
      target: { value: 'Something Else' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }))

    await waitFor(() =>
      expect(createWorkspace).toHaveBeenCalledWith({
        data: { name: 'Something Else', slug: 'my-slug', userId }
      })
    )
  })

  it('refuses an invalid slug locally instead of calling the server', async () => {
    const createWorkspace = vi.fn<CreateWorkspace>()
    await renderForm(createWorkspace)

    fireEvent.change(screen.getByLabelText('Workspace URL'), {
      target: { value: 'Bad Slug!' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }))

    expect(await screen.findByText(/Use lowercase letters/)).toBeTruthy()
    expect(createWorkspace).not.toHaveBeenCalled()
  })

  it('shows the failure message when the port rejects', async () => {
    const createWorkspace = vi
      .fn<CreateWorkspace>()
      .mockRejectedValue(new Error('slug already in use'))
    await renderForm(createWorkspace)

    fireEvent.change(screen.getByLabelText('Workspace name'), {
      target: { value: 'Acme Corp' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }))

    await screen.findByText('slug already in use')
  })
})
