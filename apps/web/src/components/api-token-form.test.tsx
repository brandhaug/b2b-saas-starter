import { type CreatedApiToken } from '@b2b-saas-starter/capabilities/src/developer-platform/api-token-registry.ts'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiTokenForm, type CreateApiToken } from './api-token-form'

const createdToken: CreatedApiToken = {
  id: 'tok_test',
  name: 'CI token',
  prefix: 'bsk_live_abcdefgh',
  scopes: ['read'],
  lastUsedAt: null,
  createdAt: '2026-05-16T09:00:00.000Z',
  token: 'bsk_live_secret_value'
}

// The form's own `createToken` port, handed in as a prop. A real function of
// the declared shape, so the module under test is the one that ships.
const createToken = vi.fn<CreateApiToken>()

function renderForm() {
  return render(<ApiTokenForm workspaceSlug="starter-lab" createToken={createToken} />)
}

describe('ApiTokenForm', () => {
  beforeEach(() => {
    createToken.mockReset()
    createToken.mockResolvedValue(createdToken)
  })

  it('shows a validation error for an empty token name', async () => {
    renderForm()
    const input = screen.getByLabelText('Token name')
    fireEvent.change(input, { target: { value: 'x' } })
    fireEvent.change(input, { target: { value: '' } })
    await screen.findByText('Token name is required')
    expect(createToken).not.toHaveBeenCalled()
  })

  it('shows a validation error when the name exceeds 80 characters', async () => {
    renderForm()
    fireEvent.change(screen.getByLabelText('Token name'), {
      target: { value: 'a'.repeat(81) }
    })
    await screen.findByText('Token name must be under 80 characters')
  })

  it('requires at least one scope', async () => {
    renderForm()
    // "read" is checked by default — uncheck it.
    const [readCheckbox] = screen.getAllByRole('checkbox')
    expect(readCheckbox).toBeDefined()
    fireEvent.click(readCheckbox!)
    await screen.findByText('Pick at least one scope')
  })

  it('submits valid input and reveals the created token once', async () => {
    renderForm()
    fireEvent.change(screen.getByLabelText('Token name'), {
      target: { value: 'CI token' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create token' }))

    await waitFor(() => expect(createToken).toHaveBeenCalledTimes(1))
    expect(createToken).toHaveBeenCalledWith({
      data: { workspaceSlug: 'starter-lab', name: 'CI token', scopes: ['read'] }
    })
    await screen.findByText('bsk_live_secret_value')
  })

  it('surfaces server errors from the server function', async () => {
    createToken.mockRejectedValueOnce(new Error('nope'))
    renderForm()
    fireEvent.change(screen.getByLabelText('Token name'), {
      target: { value: 'CI token' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create token' }))
    await screen.findByRole('alert')
    expect(screen.getByRole('alert').textContent).toContain('nope')
  })
})
