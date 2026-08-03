import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { CustomerRecord } from '@b2b-saas-starter/capabilities/customer-directory'
import { CustomerDirectoryWorkspace } from './customer-directory-workspace.tsx'

vi.mock('@/lib/server/customer-directory.ts', () => ({
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

const record: CustomerRecord = {
  id: 'cur_ana',
  merchantId: 'mer_test',
  status: 'active',
  displayName: 'Ana Popescu',
  preferredEmail: 'ana@example.com',
  preferredPhone: '+40700000000',
  contacts: [
    {
      kind: 'email',
      value: 'ana@example.com',
      status: 'active',
      preferred: true
    }
  ],
  observations: [
    {
      id: 'obs_one',
      appointmentId: 'apt_one',
      details: {
        name: 'Ana Popescu',
        email: 'ana@example.com',
        phone: '+40700000000'
      },
      observedAt: '2026-08-03T09:00:00.000Z',
      source: 'appointment'
    },
    {
      id: 'obs_two',
      appointmentId: 'apt_two',
      details: {
        name: 'Ana Popescu',
        email: 'ana@example.com',
        phone: '+40700000000'
      },
      observedAt: '2026-08-03T09:15:00.000Z',
      source: 'appointment'
    }
  ],
  notes: [],
  consent: [],
  ban: null,
  possibleDuplicateOf: ['cur_duplicate'],
  mergedInto: null,
  revision: 2,
  lastActivityAt: '2026-08-03T09:00:00.000Z',
  history: [
    {
      id: 'hst_one',
      kind: 'edited',
      actorId: 'usr_owner',
      reason: null,
      at: '2026-08-03T09:30:00.000Z',
      revision: 2
    }
  ]
}

describe('CustomerDirectoryWorkspace', () => {
  it('renders durable Customer Record operations instead of Appointment rows', () => {
    const html = renderToStaticMarkup(
      <CustomerDirectoryWorkspace initialRecords={[record]} />
    )

    expect(html).toContain('Customer Record cur_ana · revision 2')
    expect(html).toContain('Save preferred details')
    expect(html).toContain('Private Merchant Note')
    expect(html).toContain('Ban public booking')
    expect(html).toContain('Merge possible duplicate')
    expect(html).toContain('Preferred details after merge')
    expect(html).toContain('New record preferred details')
    expect(html).toContain('Move contact destinations')
    expect(html).toContain('Attributed history')
    expect(html).toContain('edited · usr_owner')
    expect(html).toContain('Import Customer Records')
    expect(html).toContain('Export customer data')
    expect(html).toContain('Show archived records')
    expect(html).not.toContain('One captured Customer Details entry per Appointment')
  })
})
