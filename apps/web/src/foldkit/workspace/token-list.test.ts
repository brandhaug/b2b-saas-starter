// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from '@testing-library/dom'
import { describe, expect, it, vi } from 'vite-plus/test'
import { demoFixtures } from '@/lib/demo-fixtures'
import * as Api from '@/lib/server/api-tokens'
import { input } from '@/components/native-test-harness'
import { renderWorkspace } from './test-harness'
import { type WorkspacePage } from './model'

const token = {
  id: 'tok_ci',
  name: 'CI token',
  prefix: 'bsk_live_abcdefgh',
  scopes: ['read' as const],
  lastUsedAt: null,
  expiresAt: null,
  replacedByTokenId: null,
  createdAt: '2026-05-16T09:00:00.000Z'
}
type Token = Extract<WorkspacePage, { _tag: 'api-tokens' }>['data']['tokens'][number]
function renderPanel(
  tokens: ReadonlyArray<Token> = [token],
  search = '',
  role: 'owner' | 'member' = 'owner'
) {
  return renderWorkspace(
    {
      _tag: 'api-tokens',
      data: { ...demoFixtures.apiTokens, tokens, viewer: { role } }
    },
    { url: `/workspaces/starter-lab/api-tokens${search}` }
  )
}
function saved(
  filters: Array<{ field: string; operator: string; value: string }> = [],
  sorts: Array<{ field: string; direction: string }> = []
) {
  return encodeURIComponent(
    JSON.stringify({ 'api-tokens': JSON.stringify({ match: 'all', filters, sorts }) })
  )
}
const many = Array.from({ length: 21 }, (_, index) => ({
  ...token,
  id: `tok_${index}`,
  name: `Token ${String(index).padStart(2, '0')}`
}))
async function menu() {
  fireEvent.click(screen.getByRole('button', { name: 'More actions for CI token' }))
  await screen.findByRole('menu')
}
describe('token list preserved behaviors', () => {
  it('keeps revoke but removes mint and replacement controls in recovery mode', async () => {
    await renderWorkspace({
      _tag: 'suspended',
      data: {
        workspaceId: 'ws_demo',
        workspaceName: 'Starter Lab',
        viewer: { role: 'owner' },
        status: 'suspended',
        customerExplanation: 'Suspended',
        changedAt: '2026-01-01T00:00:00Z',
        canViewExplanation: true,
        canManageBilling: true,
        billingConfigured: false,
        apiTokens: [token],
        ssoConnections: []
      }
    })
    expect(screen.getByRole('button', { name: 'Revoke' })).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Create a token' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Replace' })).toBeNull()
  })

  it('offers the create form and revoke control to a role that holds both', async () => {
    await renderPanel()
    await menu()
    expect(screen.getByRole('menuitem', { name: 'Revoke' })).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Create a token' }))
    expect(await screen.findByLabelText('Token name')).not.toBeNull()
  })

  it('replaces each control with its reason for a role that holds neither', async () => {
    await renderPanel([token], '', 'member')
    expect(screen.getByText('Your role cannot mint tokens.')).not.toBeNull()
    expect(screen.getByText('Your role cannot revoke tokens.')).not.toBeNull()
    expect(screen.queryByLabelText('Token name')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Revoke' })).toBeNull()
  })

  it('filters tokens by their name and prefix', async () => {
    await renderPanel([
      token,
      { ...token, id: 'deploy', name: 'Deploy token', prefix: 'bsk_test_deploy' }
    ])
    await input(screen.getByRole('textbox', { name: 'Search tokens' }), 'deploy')
    expect(await screen.findByText('Deploy token')).not.toBeNull()
    expect(screen.queryByText('CI token')).toBeNull()
  })

  it('reads a status table view from the URL', async () => {
    await renderPanel(
      [
        token,
        {
          ...token,
          id: 'expired',
          name: 'Expired token',
          expiresAt: '2000-01-01T00:00:00.000Z'
        }
      ],
      `?tableViews=${saved([{ field: 'status', operator: 'is', value: 'expired' }])}`
    )
    expect(screen.getByText('Expired token')).not.toBeNull()
    expect(screen.queryByText('CI token')).toBeNull()
  })

  it('pages through URL state and clamps an out-of-range page', async () => {
    await renderPanel(many, '?page=99')
    expect(screen.getByText('Token 20')).not.toBeNull()
    expect(screen.queryByText('Token 00')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }))
    await waitFor(() =>
      expect(new URL(window.location.href).searchParams.has('page')).toBe(false)
    )
    expect(screen.getByText('Token 00')).not.toBeNull()
  })

  it('clears this list without clearing another saved view', async () => {
    const other = JSON.stringify({
      match: 'all',
      filters: [{ field: 'name', operator: 'contains', value: 'keep' }],
      sorts: []
    })
    const views = encodeURIComponent(
      JSON.stringify({
        other,
        'api-tokens': JSON.stringify({
          match: 'all',
          filters: [{ field: 'status', operator: 'is', value: 'expired' }],
          sorts: []
        })
      })
    )
    await renderPanel([token], `?query=missing&page=3&record=keep&tableViews=${views}`)
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    expect(await screen.findByText('CI token')).not.toBeNull()
    await waitFor(() =>
      expect(new URL(window.location.href).searchParams.get('query')).toBeNull()
    )
    const search = new URL(window.location.href).searchParams
    expect(search.get('record')).toBe('keep')
    expect(search.get('tableViews')).toBe(JSON.stringify({ other }))
    expect(search.has('page')).toBe(false)
  })

  it('sorts before pagination and resets the page when searching', async () => {
    const views = saved([], [{ field: 'name', direction: 'desc' }])
    await renderPanel(many, `?page=2&tableViews=${views}`)
    expect(screen.getByText('Token 00')).not.toBeNull()
    expect(screen.queryByText('Token 20')).toBeNull()
    await input(screen.getByRole('textbox', { name: 'Search tokens' }), '20')
    expect(await screen.findByText('Token 20')).not.toBeNull()
    await waitFor(() =>
      expect(new URL(window.location.href).searchParams.has('page')).toBe(false)
    )
    expect(new URL(window.location.href).searchParams.get('tableViews')).toBe(
      decodeURIComponent(views)
    )
  })

  it('resets the page when changing a status filter', async () => {
    await renderPanel(many, '?page=2')
    fireEvent.click(screen.getByRole('button', { name: 'Status' }))
    fireEvent.click(await screen.findByRole('radio', { name: 'Active' }))
    await waitFor(() =>
      expect(new URL(window.location.href).searchParams.has('page')).toBe(false)
    )
    expect(screen.getByText('Token 00')).not.toBeNull()
    expect(screen.queryByText('Token 20')).toBeNull()
  })

  it('finds never-used tokens independently of active, expired, and replaced status', async () => {
    await renderPanel(
      [
        token,
        {
          ...token,
          id: 'expired',
          name: 'Expired unused',
          expiresAt: '2000-01-01T00:00:00.000Z'
        },
        { ...token, id: 'replaced', name: 'Replaced unused', replacedByTokenId: 'new' },
        { ...token, id: 'used', name: 'Used token', lastUsedAt: token.createdAt }
      ],
      `?tableViews=${saved([{ field: 'lastUsedAt', operator: 'isEmpty', value: '' }])}`
    )
    expect(screen.getByText('Expired unused')).not.toBeNull()
    expect(screen.getByText('Replaced unused')).not.toBeNull()
    expect(screen.queryByText('Used token')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Status' }))
    expect(screen.queryByRole('radio', { name: 'Unused' })).toBeNull()
    fireEvent.click(await screen.findByRole('radio', { name: 'Active' }))
    await waitFor(() => expect(screen.queryByText('Expired unused')).toBeNull())
    expect(screen.queryByText('Replaced unused')).toBeNull()
    expect(screen.getByText('CI token')).not.toBeNull()
  })

  it('revokes on the second click and reports a failure once', async () => {
    const revoke = vi
      .spyOn(Api, 'revokeApiTokenServerFn')
      .mockRejectedValue(new Error('Token already revoked'))
    await renderPanel()
    await menu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Revoke' }))
    expect(revoke).not.toHaveBeenCalled()
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm revoke' }))
    expect(await screen.findByText('Failed to revoke token')).not.toBeNull()
    expect(screen.getAllByText('Failed to revoke token')).toHaveLength(1)
    expect(revoke).toHaveBeenCalledWith({
      data: { workspaceSlug: 'starter-lab', tokenId: token.id }
    })
  })

  it('shows expired and replaced tokens without offering another replacement', async () => {
    await renderPanel([
      { ...token, expiresAt: '2000-01-01T00:00:00.000Z', replacedByTokenId: 'tok_new' }
    ])
    expect(screen.getByText(/Expired.*Replacement issued/)).not.toBeNull()
    await menu()
    expect(screen.queryByRole('menuitem', { name: 'Replace' })).toBeNull()
  })
})
