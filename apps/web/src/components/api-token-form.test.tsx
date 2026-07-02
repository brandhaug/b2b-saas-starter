import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CreatedApiToken } from '@b2b-saas-starter/capabilities'
import { ApiTokenForm } from './api-token-form'

const createdToken: CreatedApiToken = {
  id: 'tok_test',
  name: 'CI token',
  prefix: 'bsk_live_abcdefgh',
  scopes: ['read'],
  lastUsedAt: null,
  createdAt: '2026-05-16T09:00:00.000Z',
  token: 'bsk_live_secret_value'
}

const createApiTokenServerFn = vi.fn()

vi.mock('@/lib/server/api-tokens', () => ({
  createApiTokenServerFn: (input: unknown) => createApiTokenServerFn(input)
}))

describe('ApiTokenForm', () => {
  beforeEach(() => {
    createApiTokenServerFn.mockReset()
    createApiTokenServerFn.mockResolvedValue(createdToken)
  })

  it('shows a validation error for an empty token name', async () => {
    render(<ApiTokenForm workspaceSlug="starter-lab" />)
    const input = screen.getByLabelText('Token name')
    fireEvent.change(input, { target: { value: 'x' } })
    fireEvent.change(input, { target: { value: '' } })
    await screen.findByText('Token name is required')
    expect(createApiTokenServerFn).not.toHaveBeenCalled()
  })

  it('shows a validation error when the name exceeds 80 characters', async () => {
    render(<ApiTokenForm workspaceSlug="starter-lab" />)
    fireEvent.change(screen.getByLabelText('Token name'), {
      target: { value: 'a'.repeat(81) }
    })
    await screen.findByText('Token name must be under 80 characters')
  })

  it('requires at least one scope', async () => {
    render(<ApiTokenForm workspaceSlug="starter-lab" />)
    // "read" is checked by default — uncheck it.
    const readCheckbox = screen.getAllByRole('checkbox')[0]
    expect(readCheckbox).toBeDefined()
    fireEvent.click(readCheckbox as HTMLElement)
    await screen.findByText('Pick at least one scope')
  })

  it('submits valid input and reveals the created token once', async () => {
    render(<ApiTokenForm workspaceSlug="starter-lab" />)
    fireEvent.change(screen.getByLabelText('Token name'), {
      target: { value: 'CI token' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create token' }))

    await waitFor(() => expect(createApiTokenServerFn).toHaveBeenCalledTimes(1))
    expect(createApiTokenServerFn).toHaveBeenCalledWith({
      data: { workspaceSlug: 'starter-lab', name: 'CI token', scopes: ['read'] }
    })
    await screen.findByText('bsk_live_secret_value')
  })

  it('surfaces server errors from the server function', async () => {
    createApiTokenServerFn.mockRejectedValueOnce(new Error('nope'))
    render(<ApiTokenForm workspaceSlug="starter-lab" />)
    fireEvent.change(screen.getByLabelText('Token name'), {
      target: { value: 'CI token' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create token' }))
    await screen.findByRole('alert')
    expect(screen.getByRole('alert').textContent).toContain('nope')
  })
})
