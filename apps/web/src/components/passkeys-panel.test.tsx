import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { PasskeysPanel } from './passkeys-panel'
import { renderWithQueryClient } from '@/test/query-harness'
import { authClientDouble as fake } from '@/test/fake-auth-client'

// The panel calls the client module directly, so its endpoints are doubles
// on the mocked module — the shared per-file instance, bound without
// re-typing the module.
vi.mock('@/lib/auth-client', async () => {
  const { authClientDouble: double } = await import('@/test/fake-auth-client')
  return { authClient: double }
})

const listPasskeys = fake.passkey.listUserPasskeys
const addPasskey = fake.passkey.addPasskey
const updatePasskey = fake.passkey.updatePasskey
const deletePasskey = fake.passkey.deletePasskey

type PasskeyRowInput = {
  readonly id: string
  readonly name?: string | null | undefined
  readonly createdAt?: Date
  readonly backedUp?: boolean
}

function passkey(overrides: PasskeyRowInput & { id: string }) {
  return {
    id: overrides.id,
    name: overrides.name ?? null,
    createdAt: overrides.createdAt ?? new Date('2026-08-01T10:00:00Z'),
    backedUp: overrides.backedUp ?? true
  }
}

describe('PasskeysPanel', () => {
  beforeEach(() => {
    listPasskeys.mockReset()
    addPasskey.mockReset()
    updatePasskey.mockReset()
    deletePasskey.mockReset()
    addPasskey.mockResolvedValue({ data: null })
    updatePasskey.mockResolvedValue({ data: null })
    deletePasskey.mockResolvedValue({ data: null })
  })

  it('lists named and unnamed passkeys with their sync state', async () => {
    listPasskeys.mockResolvedValue({
      data: [
        passkey({ id: 'pk_mac', name: 'MacBook Touch ID' }),
        passkey({ id: 'pk_key', name: null, backedUp: false })
      ]
    })
    renderWithQueryClient(<PasskeysPanel />)

    expect(await screen.findByText('MacBook Touch ID')).not.toBeNull()
    expect(screen.getByText('Passkey')).not.toBeNull()
    expect(screen.getByText(/Synced passkey/)).not.toBeNull()
    expect(screen.getByText(/Device passkey/)).not.toBeNull()
    expect(
      screen.getByRole('button', { name: 'Rename MacBook Touch ID passkey' })
    ).not.toBeNull()
    expect(
      screen.getByRole('button', { name: 'Remove MacBook Touch ID passkey' })
    ).not.toBeNull()
  })

  it('omits the name when the field is left blank', async () => {
    listPasskeys.mockResolvedValue({ data: [] })
    renderWithQueryClient(<PasskeysPanel />)

    fireEvent.click(await screen.findByRole('button', { name: 'Add passkey' }))

    await waitFor(() => expect(addPasskey).toHaveBeenCalledWith({}))
  })

  it('surfaces a cancelled ceremony with the copy-table sentence', async () => {
    listPasskeys.mockResolvedValue({ data: [] })
    // A code, not a message: the panels never render the far end's raw
    // message — the copy table maps the code (see lib/auth-error-copy.ts).
    addPasskey.mockResolvedValue({ error: { code: 'AUTH_CANCELLED' } })
    renderWithQueryClient(<PasskeysPanel />)

    fireEvent.click(await screen.findByRole('button', { name: 'Add passkey' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('The passkey action was cancelled')
  })

  it('surfaces removal failures', async () => {
    listPasskeys.mockResolvedValue({
      data: [passkey({ id: 'pk_mac', name: 'MacBook' })]
    })
    // No code: the panel falls back to its own failure sentence rather than
    // rendering the raw message.
    deletePasskey.mockResolvedValue({ error: {} })
    renderWithQueryClient(<PasskeysPanel />)

    fireEvent.click(
      await screen.findByRole('button', { name: 'Remove MacBook passkey' })
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Remove passkey' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('The change could not be made')
  })
})
