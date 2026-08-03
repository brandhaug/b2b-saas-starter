// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CustomerRecord } from '@b2b-saas-starter/capabilities/customer-directory'
import { CustomerDirectoryWorkspace } from './customer-directory-workspace.tsx'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const server = vi.hoisted(() => ({
  addCustomerNote: vi.fn(),
  archiveCustomer: vi.fn(),
  banCustomer: vi.fn(),
  editCustomerPreferred: vi.fn(),
  exportCustomers: vi.fn(),
  getCustomerRecord: vi.fn(),
  importCustomers: vi.fn(),
  liftCustomerBan: vi.fn(),
  mergeCustomers: vi.fn(),
  previewCustomerImport: vi.fn(),
  recordCustomerConsent: vi.fn(),
  searchCustomerRecords: vi.fn(),
  setCustomerContactStatus: vi.fn(),
  splitCustomer: vi.fn()
}))

vi.mock('@/lib/server/customer-directory.ts', () => server)

const record = (id: string, duplicateId: string): CustomerRecord => ({
  id,
  merchantId: 'mer_test',
  status: 'active',
  displayName: id === 'cur_one' ? 'Ana Popescu' : 'Ana P.',
  preferredEmail: 'ana@example.com',
  preferredPhone: null,
  contacts: [],
  observations: [
    {
      id: `${id}_obs_one`,
      appointmentId: `${id}_apt_one`,
      details: { name: 'Ana Popescu', email: 'ana@example.com', phone: null },
      observedAt: '2026-08-03T09:00:00.000Z',
      source: 'appointment'
    },
    {
      id: `${id}_obs_two`,
      appointmentId: `${id}_apt_two`,
      details: { name: 'Ana Popescu', email: 'ana@example.com', phone: null },
      observedAt: '2026-08-03T10:00:00.000Z',
      source: 'appointment'
    }
  ],
  notes: [],
  consent: [],
  ban: null,
  possibleDuplicateOf: [duplicateId],
  mergedInto: null,
  revision: 2,
  lastActivityAt: '2026-08-03T10:00:00.000Z',
  history: []
})

const records = [record('cur_one', 'cur_two'), record('cur_two', 'cur_one')]
let root: Root | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

const renderWorkspace = async (initialRecords = records) => {
  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () =>
    root?.render(<CustomerDirectoryWorkspace initialRecords={initialRecords} />)
  )
  return container
}

const formWithButton = (container: HTMLElement, label: string) =>
  [...container.querySelectorAll('form')].find((form) =>
    [...form.querySelectorAll('button')].some((button) =>
      button.textContent?.includes(label)
    )
  )

describe('CustomerDirectoryWorkspace conflict recovery', () => {
  it('withdraws the displayed consent purpose for its exact destination', async () => {
    const marketingRecord: CustomerRecord = {
      ...records[0]!,
      consent: [
        {
          id: 'cue_marketing',
          purpose: 'marketing',
          destination: 'ana@example.com',
          wordingVersion: 'marketing-v1',
          source: 'merchant_directory',
          grantedAt: '2026-08-03T11:00:00.000Z',
          withdrawnAt: null
        }
      ]
    }
    server.recordCustomerConsent.mockResolvedValueOnce(marketingRecord)
    const container = await renderWorkspace([marketingRecord])
    const button = [...container.querySelectorAll('button')].find((candidate) =>
      candidate.textContent?.includes('Record withdrawal')
    )!

    await act(async () => button.click())

    expect(server.recordCustomerConsent).toHaveBeenCalledWith({
      data: expect.objectContaining({
        purpose: 'marketing',
        destination: 'ana@example.com',
        withdrawn: true
      })
    })
  })

  it('downloads the privacy-minimal Customer Directory export', async () => {
    server.exportCustomers.mockResolvedValueOnce([
      {
        id: 'cur_one',
        name: 'Ana Popescu',
        email: 'ana@example.com',
        phone: null,
        status: 'active',
        appointmentIds: ['cur_one_apt_one']
      }
    ])
    const createObjectURL = vi.fn(() => 'blob:customer-export')
    const revokeObjectURL = vi.fn()
    Object.defineProperties(URL, {
      createObjectURL: { configurable: true, value: createObjectURL },
      revokeObjectURL: { configurable: true, value: revokeObjectURL }
    })
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined)
    const container = await renderWorkspace()
    const button = [...container.querySelectorAll('button')].find((candidate) =>
      candidate.textContent?.includes('Export customer data')
    )!

    await act(async () => button.click())

    expect(server.exportCustomers).toHaveBeenCalledOnce()
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob))
    expect(click).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:customer-export')
    expect(container.textContent).toContain('Exported 1 customer records.')
  })

  it('loads archived records only through the explicit restore workflow', async () => {
    const archived = {
      ...record('cur_archived', 'cur_two'),
      status: 'archived' as const,
      displayName: 'Archived Customer'
    }
    server.searchCustomerRecords.mockResolvedValueOnce([...records, archived])
    const container = await renderWorkspace()
    expect(container.textContent).not.toContain('Archived Customer')
    const button = [...container.querySelectorAll('button')].find((candidate) =>
      candidate.textContent?.includes('Show archived records')
    )!

    await act(async () => button.click())

    expect(server.searchCustomerRecords).toHaveBeenCalledWith({
      data: { query: '', includeArchived: true }
    })
    expect(container.textContent).toContain('Archived Customer')
    expect(container.textContent).toContain('Hide archived records')
  })

  it('reloads both merge records after an unconfirmed merge', async () => {
    server.mergeCustomers.mockRejectedValueOnce(new Error('stale'))
    server.searchCustomerRecords.mockResolvedValueOnce(records)
    const container = await renderWorkspace()
    const form = formWithButton(container, 'Merge into this record')!
    const absorbed = form.querySelector(
      'select[name="absorbedId"]'
    ) as unknown as HTMLSelectElement
    absorbed.value = 'cur_two'
    form.querySelector<HTMLInputElement>('input[name="reason"]')!.value = 'Same person'

    await act(async () => form.requestSubmit())

    expect(server.searchCustomerRecords).toHaveBeenCalledWith({
      data: { query: '', includeArchived: false }
    })
    expect(container.textContent).toContain('Both records were reloaded')
  })

  it('reloads the directory after an unconfirmed split', async () => {
    server.splitCustomer.mockRejectedValueOnce(new Error('stale'))
    server.searchCustomerRecords.mockResolvedValueOnce(records)
    const container = await renderWorkspace()
    const form = formWithButton(container, 'Create split record')!
    form.querySelector<HTMLInputElement>('input[name="observationId"]')!.checked = true
    form.querySelector<HTMLInputElement>('input[name="reason"]')!.value = 'Wrong merge'

    await act(async () => form.requestSubmit())

    expect(server.searchCustomerRecords).toHaveBeenCalledWith({
      data: { query: '', includeArchived: false }
    })
    expect(container.textContent).toContain('directory was reloaded')
  })
})
