import { fireEvent, screen } from '@testing-library/react'
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
