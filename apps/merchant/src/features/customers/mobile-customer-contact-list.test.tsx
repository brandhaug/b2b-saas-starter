import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { CustomerRecord } from '@b2b-saas-starter/capabilities/customer-directory'
import { customerInitials, filterCustomerEntries } from './customer-contact-model.ts'
import { MobileCustomerContactList } from './mobile-customer-contact-list.tsx'
import type { CustomerDirectoryView } from './customer-contact-model.ts'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    state: _state,
    search: _search,
    params: _params,
    viewTransition: _viewTransition,
    ...props
  }: {
    readonly children: ReactNode
    readonly to: string
    readonly state?: unknown
    readonly search?: unknown
    readonly params?: unknown
    readonly viewTransition?: boolean
  }) => (
    <a href={to} {...props}>
      {children}
    </a>
  )
}))

const record = (
  id: string,
  displayName: string,
  preferredEmail: string,
  preferredPhone: string | null,
  lastActivityAt: string
): CustomerRecord => ({
  id,
  merchantId: 'mer_test',
  status: 'active',
  displayName,
  preferredEmail,
  preferredPhone,
  contacts: [],
  observations: [],
  notes: [],
  consent: [],
  ban: null,
  possibleDuplicateOf: [],
  mergedInto: null,
  revision: 1,
  lastActivityAt,
  history: []
})

const directory: CustomerDirectoryView = {
  entries: [
    {
      ...record(
        'cur_mara',
        'Mara Ionescu',
        'mara@example.com',
        '+40700000001',
        '2026-07-24T09:00:00.000Z'
      ),
      contacts: [
        {
          kind: 'email',
          value: 'mara.old@example.com',
          status: 'superseded',
          preferred: false
        }
      ],
      observations: [
        {
          id: 'cuo_mara_old',
          appointmentId: 'apt_mara_old',
          details: {
            name: 'Mara Popescu',
            email: 'mara.old@example.com',
            phone: null
          },
          observedAt: '2026-06-24T09:00:00.000Z',
          source: 'appointment'
        }
      ]
    },
    record('cur_vlad', 'Vlad Pop', 'vlad@example.com', null, '2026-07-23T14:00:00.000Z')
  ]
}

describe('MobileCustomerContactList', () => {
  it('uses the compact Poke Mail search and list grammar', () => {
    const html = renderToStaticMarkup(
      <MobileCustomerContactList directory={directory} />
    )

    expect(html).toContain('data-mobile-customer-directory="true"')
    expect(html).toContain('data-mobile-customer-search-header="true"')
    expect(html).toContain('data-mobile-customer-list-spring="true"')
    expect(html).toContain('data-mobile-edge-spring="idle"')
    expect(html).toContain('placeholder="Search customers"')
    expect(html).toContain('h-10')
    expect(html).toContain('-mx-4')
    expect(html).toContain('appearance-none')
    expect(html).toContain('[&amp;::-webkit-search-cancel-button]:hidden')
    expect(html).toContain('rounded-2xl')
    expect(html).toContain('size-10')
    expect(html).toContain('min-h-[5.25rem]')
    expect(html).toContain('Mara Ionescu')
    expect(html).toContain('mara@example.com')
    expect(html).not.toContain('<table')
  })

  it('filters against names, emails, and phone numbers', () => {
    expect(filterCustomerEntries(directory.entries, 'mara')).toEqual([
      directory.entries[0]
    ])
    expect(filterCustomerEntries(directory.entries, 'VLAD@EXAMPLE')).toEqual([
      directory.entries[1]
    ])
    expect(filterCustomerEntries(directory.entries, '000 001')).toEqual([
      directory.entries[0]
    ])
    expect(filterCustomerEntries(directory.entries, '(407) 000-000-01')).toEqual([
      directory.entries[0]
    ])
    expect(filterCustomerEntries(directory.entries, 'Mara Popescu')).toEqual([
      directory.entries[0]
    ])
    expect(filterCustomerEntries(directory.entries, 'mara.old@example')).toEqual([
      directory.entries[0]
    ])
    expect(filterCustomerEntries(directory.entries, 'missing')).toEqual([])
  })

  it('builds stable two-letter contact initials', () => {
    expect(customerInitials('Mara Ionescu')).toBe('MI')
    expect(customerInitials(' Vlad ')).toBe('V')
    expect(customerInitials('')).toBe('?')
  })
})
