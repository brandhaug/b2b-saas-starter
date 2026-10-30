// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from '@testing-library/dom'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import * as Api from '@/lib/server/api-tokens'
import { demoFixtures } from '@/lib/demo-fixtures'
import { input } from '@/components/native-test-harness'
import { renderWorkspace } from './test-harness'

const token = {
  id: 'tok_old',
  name: 'CI token',
  prefix: 'bsk_old',
  scopes: ['read' as const],
  createdAt: '2026-01-01T00:00:00.000Z',
  lastUsedAt: null,
  expiresAt: null,
  replacedByTokenId: null
}
const data = { ...demoFixtures.apiTokens, tokens: [token] }
beforeEach(() => {
  vi.spyOn(Api, 'loadWorkspaceApiTokensServerFn').mockResolvedValue(data)
  vi.spyOn(Api, 'createApiTokenServerFn').mockResolvedValue({
    ...token,
    token: 'bsk_live_secret_value'
  })
  vi.spyOn(Api, 'replaceApiTokenServerFn').mockResolvedValue({
    ...token,
    id: 'tok_new',
    token: 'bsk_replacement_secret',
    previousTokenId: token.id,
    previousTokenExpiresAt: '2026-09-06T12:00:00.000Z'
  })
})
function renderForm(replacement = false) {
  return renderWorkspace(
    { _tag: 'api-tokens', data },
    replacement
      ? {
          model: (model) => ({
            ...model,
            tokens: { ...model.tokens, replacement: token.id }
          })
        }
      : { url: '/workspaces/starter-lab/api-tokens?action=create' }
  )
}
describe('token creation preserved behaviors', () => {
  it('shows a validation error for an empty token name', async () => {
    await renderForm()
    await input(screen.getByLabelText('Token name'), 'x')
    await input(screen.getByLabelText('Token name'), '')
    expect(await screen.findByText('Token name is required')).not.toBeNull()
    expect(Api.createApiTokenServerFn).not.toHaveBeenCalled()
  })

  it('shows a validation error when the name exceeds 100 characters', async () => {
    await renderForm()
    await input(screen.getByLabelText('Token name'), 'a'.repeat(101))
    expect(
      await screen.findByText('Token name must be at most 100 characters')
    ).not.toBeNull()
  })

  it('requires at least one scope', async () => {
    await renderForm()
    fireEvent.click(await screen.findByRole('checkbox', { name: 'read' }))
    expect(await screen.findByText('Pick at least one scope')).not.toBeNull()
  })

  it('submits valid input and reveals the created token once', async () => {
    await renderForm()
    await input(screen.getByLabelText('Token name'), 'CI token')
    fireEvent.click(screen.getByRole('button', { name: 'Create token' }))
    await waitFor(() => expect(Api.createApiTokenServerFn).toHaveBeenCalledTimes(1))
    expect(Api.createApiTokenServerFn).toHaveBeenCalledWith({
      data: { workspaceSlug: 'starter-lab', name: 'CI token', scopes: ['read'] }
    })
    expect(screen.queryByText('bsk_live_secret_value')).toBeNull()
    fireEvent.click(await screen.findByRole('button', { name: 'Show API token' }))
    expect(await screen.findByText('bsk_live_secret_value')).not.toBeNull()
  })

  it('surfaces server errors from the server function', async () => {
    vi.mocked(Api.createApiTokenServerFn).mockRejectedValueOnce(new Error('nope'))
    await renderForm()
    await input(screen.getByLabelText('Token name'), 'CI token')
    fireEvent.click(screen.getByRole('button', { name: 'Create token' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Failed to create token')
  })

  it('submits the chosen expiry as UTC', async () => {
    await renderForm()
    await input(screen.getByLabelText('Token name'), 'Expiring')
    await input(screen.getByLabelText('Expiry (UTC, optional)'), '2099-01-01T12:30')
    fireEvent.click(screen.getByRole('button', { name: 'Create token' }))
    await waitFor(() =>
      expect(Api.createApiTokenServerFn).toHaveBeenCalledWith({
        data: {
          workspaceSlug: 'starter-lab',
          name: 'Expiring',
          scopes: ['read'],
          expiresAt: '2099-01-01T12:30:00.000Z'
        }
      })
    )
  })
})
describe('token replacement preserved behaviors', () => {
  it('offers only existing scopes and preserves the secret through list refresh', async () => {
    await renderForm(true)
    expect(screen.getAllByRole('checkbox')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Create replacement' }))
    await waitFor(() =>
      expect(Api.loadWorkspaceApiTokensServerFn).toHaveBeenCalledOnce()
    )
    expect(Api.replaceApiTokenServerFn).toHaveBeenCalledWith({
      data: {
        workspaceSlug: 'starter-lab',
        tokenId: token.id,
        scopes: ['read'],
        overlapSeconds: 3600
      }
    })
    fireEvent.click(
      await screen.findByRole('button', { name: 'Show Replacement API token' })
    )
    expect(await screen.findByText('bsk_replacement_secret')).not.toBeNull()
    expect(
      screen.getByText(/Update your clients before the old credential expires at/)
    ).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByText('bsk_replacement_secret')).toBeNull())
  })

  it('submits immediate retirement when overlap is zero', async () => {
    await renderForm(true)
    await input(screen.getByLabelText('Old credential overlap (seconds)'), '0')
    fireEvent.click(screen.getByRole('button', { name: 'Create replacement' }))
    await waitFor(() =>
      expect(Api.replaceApiTokenServerFn).toHaveBeenCalledWith({
        data: {
          workspaceSlug: 'starter-lab',
          tokenId: token.id,
          scopes: ['read'],
          overlapSeconds: 0
        }
      })
    )
  })

  it('rejects overlap above 24 hours and leaves failures retryable', async () => {
    await renderForm(true)
    await input(screen.getByLabelText('Old credential overlap (seconds)'), '86401')
    expect(await screen.findByText('Choose between 0 and 86400 seconds')).not.toBeNull()
    expect(Api.replaceApiTokenServerFn).not.toHaveBeenCalled()
    vi.mocked(Api.replaceApiTokenServerFn).mockRejectedValueOnce(
      new Error('Token is no longer active')
    )
    await input(screen.getByLabelText('Old credential overlap (seconds)'), '60')
    fireEvent.click(screen.getByRole('button', { name: 'Create replacement' }))
    expect(await screen.findByText('Failed to replace token')).not.toBeNull()
    expect(Api.loadWorkspaceApiTokensServerFn).not.toHaveBeenCalled()
  })
})
