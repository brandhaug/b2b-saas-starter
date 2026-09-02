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
  createdAt: '2026-05-16T09:00:00.000Z'
}

const revokeToken = vi.fn<RevokeApiToken>()
const createToken = vi.fn<CreateApiToken>()

function renderPanel(input: {
  readonly role: 'owner' | 'member'
  readonly tokens?: ReadonlyArray<ApiToken>
}) {
  return renderWithRouter(
    <ApiTokensPanel
      workspaceSlug="starter-lab"
      tokens={input.tokens ?? [token]}
      viewer={{ role: input.role }}
      revokeToken={revokeToken}
      createToken={createToken}
    />
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
    expect(screen.getByRole('heading', { name: 'Create a token' })).toBeTruthy()
    expect(screen.getByLabelText('Token name')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Revoke' })).toBeTruthy()
    expect(screen.queryByText('Your role cannot mint tokens.')).toBeNull()
    expect(screen.queryByText('Your role cannot revoke tokens.')).toBeNull()
  })

  it('replaces each control with its reason for a role that holds neither', async () => {
    await renderPanel({ role: 'member' })
    expect(screen.getByText('Your role cannot mint tokens.')).toBeTruthy()
    expect(screen.getByText('Your role cannot revoke tokens.')).toBeTruthy()
    expect(screen.queryByLabelText('Token name')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Revoke' })).toBeNull()
  })

  it('renders timestamps in UTC and names an unused token "never"', async () => {
    await renderPanel({ role: 'owner' })
    expect(
      screen.getByText('Created 5/16/2026, 9:00:00 AM · Last used never')
    ).toBeTruthy()
  })

  it('shows the empty state with no tokens', async () => {
    await renderPanel({ role: 'owner', tokens: [] })
    expect(screen.getByText('No active tokens')).toBeTruthy()
  })

  it('revokes on the second click and reports a failure once', async () => {
    revokeToken.mockRejectedValue(new Error('Token already revoked'))
    await renderPanel({ role: 'owner' })
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm revoke' }))
    await waitFor(() => {
      expect(screen.getByText('Token already revoked')).toBeTruthy()
    })
    expect(revokeToken).toHaveBeenCalledWith({
      data: { workspaceSlug: 'starter-lab', tokenId: 'tok_ci' }
    })
  })
})
