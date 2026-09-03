import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  PasskeysPanel,
  type AddPasskey,
  type DeletePasskey,
  type ListPasskeys,
  type PasskeyRecord,
  type UpdatePasskeyName
} from './passkeys-panel'
import { renderWithQueryClient } from '@/test/query-harness'

const listPasskeys = vi.fn<ListPasskeys>()
const addPasskey = vi.fn<AddPasskey>()
const updatePasskey = vi.fn<UpdatePasskeyName>()
const deletePasskey = vi.fn<DeletePasskey>()

type PasskeyRowInput = {
  readonly id: string
  readonly name?: string | null | undefined
  readonly createdAt?: Date
  readonly backedUp?: boolean
  readonly deviceType?: string
}

function passkey(overrides: PasskeyRowInput & { id: string }): PasskeyRecord {
  return {
    id: overrides.id,
    name: overrides.name ?? null,
    createdAt: overrides.createdAt ?? new Date('2026-08-01T10:00:00Z'),
    deviceType: overrides.deviceType ?? 'multiDevice',
    backedUp: overrides.backedUp ?? true,
    aaguid: null
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
    renderWithQueryClient(
      <PasskeysPanel
        listPasskeys={listPasskeys}
        addPasskey={addPasskey}
        updatePasskey={updatePasskey}
        deletePasskey={deletePasskey}
      />
    )

    expect(await screen.findByText('MacBook Touch ID')).toBeDefined()
    expect(screen.getByText('Passkey')).toBeDefined()
    expect(screen.getByText(/Synced passkey/)).toBeDefined()
    expect(screen.getByText(/Device passkey/)).toBeDefined()
    expect(
      screen.getByRole('button', { name: 'Rename MacBook Touch ID passkey' })
    ).toBeDefined()
    expect(
      screen.getByRole('button', { name: 'Remove MacBook Touch ID passkey' })
    ).toBeDefined()
  })

  it('shows the empty state when no passkeys exist', async () => {
    listPasskeys.mockResolvedValue({ data: [] })
    renderWithQueryClient(
      <PasskeysPanel
        listPasskeys={listPasskeys}
        addPasskey={addPasskey}
        updatePasskey={updatePasskey}
        deletePasskey={deletePasskey}
      />
    )

    expect(await screen.findByText(/No passkeys yet/)).toBeDefined()
  })

  it('registers a passkey with the chosen name and refreshes the list', async () => {
    listPasskeys.mockResolvedValueOnce({ data: [] }).mockResolvedValueOnce({
      data: [passkey({ id: 'pk_new', name: 'Phone' })]
    })
    renderWithQueryClient(
      <PasskeysPanel
        listPasskeys={listPasskeys}
        addPasskey={addPasskey}
        updatePasskey={updatePasskey}
        deletePasskey={deletePasskey}
      />
    )

    fireEvent.change(await screen.findByLabelText('Name a new passkey'), {
      target: { value: 'Phone' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add passkey' }))

    await waitFor(() => expect(addPasskey).toHaveBeenCalledWith({ name: 'Phone' }))
    expect(await screen.findByText('Phone')).toBeDefined()
  })

  it('omits the name when the field is left blank', async () => {
    listPasskeys.mockResolvedValue({ data: [] })
    renderWithQueryClient(
      <PasskeysPanel
        listPasskeys={listPasskeys}
        addPasskey={addPasskey}
        updatePasskey={updatePasskey}
        deletePasskey={deletePasskey}
      />
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Add passkey' }))

    await waitFor(() => expect(addPasskey).toHaveBeenCalledWith({}))
  })

  it('surfaces a cancelled ceremony as its error message', async () => {
    listPasskeys.mockResolvedValue({ data: [] })
    addPasskey.mockResolvedValue({ error: { message: 'Registration cancelled' } })
    renderWithQueryClient(
      <PasskeysPanel
        listPasskeys={listPasskeys}
        addPasskey={addPasskey}
        updatePasskey={updatePasskey}
        deletePasskey={deletePasskey}
      />
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Add passkey' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Registration cancelled')
  })

  it('renames a passkey inline and refreshes the list', async () => {
    listPasskeys
      .mockResolvedValueOnce({ data: [passkey({ id: 'pk_mac', name: 'MacBook' })] })
      .mockResolvedValueOnce({ data: [passkey({ id: 'pk_mac', name: 'Tablet' })] })
    renderWithQueryClient(
      <PasskeysPanel
        listPasskeys={listPasskeys}
        addPasskey={addPasskey}
        updatePasskey={updatePasskey}
        deletePasskey={deletePasskey}
      />
    )

    fireEvent.click(
      await screen.findByRole('button', { name: 'Rename MacBook passkey' })
    )
    const field = await screen.findByLabelText('New name')
    fireEvent.change(field, { target: { value: 'Tablet' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(updatePasskey).toHaveBeenCalledWith({ id: 'pk_mac', name: 'Tablet' })
    )
    expect(await screen.findByText('Tablet')).toBeDefined()
  })

  it('removes a passkey behind a confirmation and refreshes the list', async () => {
    listPasskeys
      .mockResolvedValueOnce({ data: [passkey({ id: 'pk_mac', name: 'MacBook' })] })
      .mockResolvedValueOnce({ data: [] })
    renderWithQueryClient(
      <PasskeysPanel
        listPasskeys={listPasskeys}
        addPasskey={addPasskey}
        updatePasskey={updatePasskey}
        deletePasskey={deletePasskey}
      />
    )

    fireEvent.click(
      await screen.findByRole('button', { name: 'Remove MacBook passkey' })
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Remove passkey' }))

    await waitFor(() => expect(deletePasskey).toHaveBeenCalledWith({ id: 'pk_mac' }))
    expect(await screen.findByText(/No passkeys yet/)).toBeDefined()
  })

  it('surfaces removal failures', async () => {
    listPasskeys.mockResolvedValue({
      data: [passkey({ id: 'pk_mac', name: 'MacBook' })]
    })
    deletePasskey.mockResolvedValue({ error: { message: 'Could not delete' } })
    renderWithQueryClient(
      <PasskeysPanel
        listPasskeys={listPasskeys}
        addPasskey={addPasskey}
        updatePasskey={updatePasskey}
        deletePasskey={deletePasskey}
      />
    )

    fireEvent.click(
      await screen.findByRole('button', { name: 'Remove MacBook passkey' })
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Remove passkey' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Could not delete')
  })
})
