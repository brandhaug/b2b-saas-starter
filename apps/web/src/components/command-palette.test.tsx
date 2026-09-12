import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { CommandPaletteProvider, SearchButton } from './command-palette'
import { renderWithRouter } from '@/test/router-harness'

// This test exercises navigation entries, independent of the content catalog.
vi.mock('@/lib/docs', () => ({ getAllDocMeta: async () => [] }))

// jsdom has no layout observer; cmdk uses it only to size its list.
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    value: () => {}
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
})

describe('command palette permissions', () => {
  it('offers owner and system-admin destinations on the first open', async () => {
    await renderWithRouter(
      <CommandPaletteProvider viewer={{ role: 'owner' }} systemRole="admin">
        <SearchButton />
      </CommandPaletteProvider>,
      {
        path: '/workspaces/$workspaceSlug',
        initialEntry: '/workspaces/starter-lab',
        destinations: ['/admin']
      }
    )
    const [searchButton] = screen.getAllByRole('button', { name: 'Search' })
    if (!searchButton) {
      throw new Error('Search button missing')
    }
    fireEvent.click(searchButton)
    expect(
      await screen.findByRole('option', { name: 'API tokens' }, { timeout: 10_000 })
    ).not.toBeNull()
    expect(screen.getByRole('option', { name: 'System admin' })).not.toBeNull()
  }, 15_000)

  it('limits a member keyboard search to permitted destinations', async () => {
    await renderWithRouter(
      <CommandPaletteProvider viewer={{ role: 'member' }} systemRole="user">
        <SearchButton />
      </CommandPaletteProvider>,
      {
        path: '/workspaces/$workspaceSlug',
        initialEntry: '/workspaces/starter-lab'
      }
    )
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
    expect(await screen.findByRole('option', { name: 'Overview' })).not.toBeNull()
    expect(screen.queryByRole('option', { name: 'API tokens' })).toBeNull()
    expect(screen.queryByRole('option', { name: 'System admin' })).toBeNull()
  })
})

describe('workspace commands', () => {
  it('opens an invitation directly and lists workspace actions first', async () => {
    const { router } = await renderWithRouter(
      <CommandPaletteProvider viewer={{ role: 'owner' }}>
        <SearchButton />
      </CommandPaletteProvider>,
      {
        path: '/workspaces/$workspaceSlug',
        initialEntry: '/workspaces/starter-lab',
        destinations: ['/workspaces/$workspaceSlug/members']
      }
    )
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
    const invite = await screen.findByRole('option', { name: 'Invite a member' })
    expect(screen.getAllByRole('option')[0]).toBe(invite)
    fireEvent.click(invite)
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/workspaces/starter-lab/members')
    )
    expect(router.state.location.search.action).toBe('invite')
  })

  it('looks up members using the entered email without offering forbidden mutations', async () => {
    const { router } = await renderWithRouter(
      <CommandPaletteProvider viewer={{ role: 'member' }}>
        <SearchButton />
      </CommandPaletteProvider>,
      {
        path: '/workspaces/$workspaceSlug',
        initialEntry: '/workspaces/starter-lab',
        destinations: ['/workspaces/$workspaceSlug/members']
      }
    )
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
    const input = await screen.findByRole('combobox')
    expect(screen.queryByRole('option', { name: 'Invite a member' })).toBeNull()
    fireEvent.change(input, { target: { value: 'ops@example.com' } })
    fireEvent.click(
      await screen.findByRole('option', {
        name: 'Find members matching "ops@example.com"'
      })
    )
    await waitFor(() =>
      expect(router.state.location.search.query).toBe('ops@example.com')
    )
    expect(router.state.location.pathname).toBe('/workspaces/starter-lab/members')
  })
})
