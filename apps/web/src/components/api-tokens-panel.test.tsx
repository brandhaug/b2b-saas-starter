import { type ApiToken } from '@b2b-saas-starter/capabilities/developer-platform/api-token-registry'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { ApiTokensPanel, type RevokeApiToken } from './api-tokens-panel'
import { type CreateApiToken } from './api-token-form'
import { renderWithRouter } from '@/test/router-harness'

const token: ApiToken = {
  id: 'tok_ci',
  name: 'CI token',
  prefix: 'bsk_live_abcdefgh',
  scopes: ['read'],
  lastUsedAt: null,
  expiresAt: null,
  replacedByTokenId: null,
  createdAt: '2026-05-16T09:00:00.000Z'
}

const revokeToken = vi.fn<RevokeApiToken>()
const createToken = vi.fn<CreateApiToken>()

function renderPanel(input: {
  readonly role: 'owner' | 'member'
  readonly tokens?: ReadonlyArray<ApiToken>
  readonly creation?: 'visible' | 'hidden'
  readonly initialEntry?: string
}) {
  return renderWithRouter(
    <ApiTokensPanel
      workspaceSlug="starter-lab"
      tokens={input.tokens ?? [token]}
      viewer={{ role: input.role }}
      revokeToken={revokeToken}
      createToken={createToken}
      {...(input.creation === undefined ? {} : { creation: input.creation })}
    />,
    input.initialEntry === undefined ? undefined : { initialEntry: input.initialEntry }
  )
}

describe('ApiTokensPanel', () => {
  beforeEach(() => {
    revokeToken.mockReset()
    revokeToken.mockResolvedValue(true)
    createToken.mockReset()
  })

  it('offers the create form and the revoke control to a role that holds both', async () => {
    await renderPanel({ role: 'owner' })
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    expect(screen.getByRole('menuitem', { name: 'Revoke' })).not.toBeNull()
    expect(screen.queryByText('Your role cannot mint tokens.')).toBeNull()
    expect(screen.queryByText('Your role cannot revoke tokens.')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Create a token' }))
    expect(screen.getByLabelText('Token name')).not.toBeNull()
  })

  it('leaves naming the list to the page header', async () => {
    await renderPanel({ role: 'owner' })
    // The page's h1 already reads "API tokens"; the panel adds the create
    // action beside it instead of a second heading.
    expect(screen.queryByRole('heading', { name: 'API tokens' })).toBeNull()
  })

  it('keeps revoke but removes mint and replacement controls in recovery mode', async () => {
    await renderPanel({ role: 'owner', creation: 'hidden' })
    expect(screen.queryByRole('button', { name: 'Create a token' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Replace' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    expect(screen.getByRole('menuitem', { name: 'Revoke' })).not.toBeNull()
  })

  it('replaces each control with its reason for a role that holds neither', async () => {
    await renderPanel({ role: 'member' })
    expect(screen.getByText('Your role cannot mint tokens.')).not.toBeNull()
    expect(screen.getByText('Your role cannot revoke tokens.')).not.toBeNull()
    expect(screen.queryByLabelText('Token name')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Revoke' })).toBeNull()
  })

  it('renders timestamps in UTC and names an unused token "never"', async () => {
    await renderPanel({ role: 'owner' })
    expect(
      screen.getByText('Created 5/16/2026, 9:00:00 AM · Last used never')
    ).not.toBeNull()
  })

  it('shows the empty state with no tokens', async () => {
    await renderPanel({ role: 'owner', tokens: [] })
    expect(screen.getByText('No tokens')).not.toBeNull()
  })

  it('filters tokens by their name and prefix', async () => {
    await renderPanel({
      role: 'owner',
      tokens: [
        token,
        { ...token, id: 'tok_deploy', name: 'Deploy token', prefix: 'bsk_test_deploy' }
      ]
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'Search tokens' }), {
      target: { value: 'deploy' }
    })
    expect(screen.getByText('Deploy token')).not.toBeNull()
    expect(screen.queryByText('CI token')).toBeNull()
  })

  it('reads an unused-token attention filter from the URL', async () => {
    await renderPanel({
      role: 'owner',
      initialEntry: '/?filter=unused',
      tokens: [
        token,
        { ...token, id: 'tok_used', name: 'Used token', lastUsedAt: token.createdAt }
      ]
    })
    expect(screen.getByText('CI token')).not.toBeNull()
    expect(screen.queryByText('Used token')).toBeNull()
  })

  it('pages through URL state and clamps an out-of-range page', async () => {
    const tokens = Array.from({ length: 21 }, (_, index) => ({
      ...token,
      id: `tok_${index}`,
      name: `Token ${String(index).padStart(2, '0')}`,
      createdAt: `2026-05-${String(index + 1).padStart(2, '0')}T09:00:00.000Z`
    }))
    const { router } = await renderPanel({
      role: 'owner',
      tokens,
      initialEntry: '/?page=99&sort=name'
    })
    expect(screen.getByText('Token 20')).not.toBeNull()
    expect(screen.queryByText('Token 00')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }))
    await waitFor(() => {
      expect(router.state.location.search.page).toBeUndefined()
    })
    expect(screen.getByText('Token 00')).not.toBeNull()
  })

  it('revokes on the second click and reports a failure once', async () => {
    revokeToken.mockRejectedValue(new Error('Token already revoked'))
    await renderPanel({ role: 'owner' })
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Revoke' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm revoke' }))
    await waitFor(() => {
      expect(screen.getByText('Failed to revoke token')).not.toBeNull()
    })
    expect(revokeToken).toHaveBeenCalledWith({
      data: { workspaceSlug: 'starter-lab', tokenId: 'tok_ci' }
    })
  })
})

it('shows expired and replaced tokens without offering another replacement', async () => {
  await renderPanel({
    role: 'owner',
    tokens: [
      { ...token, expiresAt: '2000-01-01T00:00:00.000Z', replacedByTokenId: 'tok_new' }
    ]
  })
  expect(screen.getByText(/Expired.*Replacement issued/)).not.toBeNull()
  expect(screen.queryByRole('button', { name: 'Replace' })).toBeNull()
})
