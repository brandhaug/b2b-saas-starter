import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { type ApiToken } from '@b2b-saas-starter/capabilities/developer-platform/api-token-registry'
import {
  ApiTokenReplacementForm,
  type ReplaceApiToken
} from './api-token-replacement-form'

const token: ApiToken = {
  id: 'tok_old',
  name: 'CI',
  prefix: 'bsk_old',
  scopes: ['read'],
  createdAt: '2026-01-01T00:00:00.000Z',
  lastUsedAt: null,
  expiresAt: null,
  replacedByTokenId: null
}
const replaceToken = vi.fn<ReplaceApiToken>()
const onReplaced = vi.fn<() => Promise<void>>()
const onClose = vi.fn<() => void>()
function renderForm() {
  render(
    <ApiTokenReplacementForm
      workspaceSlug="starter-lab"
      token={token}
      replaceToken={replaceToken}
      onReplaced={onReplaced}
      onClose={onClose}
    />
  )
}

describe('ApiTokenReplacementForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    onReplaced.mockResolvedValue()
    replaceToken.mockResolvedValue({
      ...token,
      id: 'tok_new',
      token: 'bsk_replacement_secret',
      previousTokenId: token.id,
      previousTokenExpiresAt: '2026-09-06T12:00:00.000Z'
    })
  })

  it('offers only existing scopes and preserves the secret through list refresh', async () => {
    renderForm()
    expect(screen.getAllByRole('checkbox')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Create replacement' }))
    await waitFor(() => expect(onReplaced).toHaveBeenCalledOnce())
    expect(replaceToken).toHaveBeenCalledWith({
      data: {
        workspaceSlug: 'starter-lab',
        tokenId: 'tok_old',
        scopes: ['read'],
        overlapSeconds: 3600
      }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Show Replacement API token' }))
    expect(screen.getByText('bsk_replacement_secret')).toBeTruthy()
    expect(
      screen.getByText(
        /Update your clients before the old credential expires at Sep 6, 2026, 12:00 PM UTC/
      )
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close replacement' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('submits immediate retirement when overlap is zero', async () => {
    renderForm()
    fireEvent.change(screen.getByLabelText('Old credential overlap (seconds)'), {
      target: { value: '0' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create replacement' }))
    await waitFor(() =>
      expect(replaceToken).toHaveBeenCalledWith({
        data: {
          workspaceSlug: 'starter-lab',
          tokenId: 'tok_old',
          scopes: ['read'],
          overlapSeconds: 0
        }
      })
    )
  })

  it('rejects overlap above 24 hours and leaves failures retryable', async () => {
    renderForm()
    fireEvent.change(screen.getByLabelText('Old credential overlap (seconds)'), {
      target: { value: '86401' }
    })
    await screen.findByText('Choose between 0 and 86400 seconds')
    expect(replaceToken).not.toHaveBeenCalled()
    replaceToken.mockRejectedValueOnce(new Error('Token is no longer active'))
    fireEvent.change(screen.getByLabelText('Old credential overlap (seconds)'), {
      target: { value: '60' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create replacement' }))
    await screen.findByText('Failed to replace token')
    expect(onReplaced).not.toHaveBeenCalled()
  })
})
