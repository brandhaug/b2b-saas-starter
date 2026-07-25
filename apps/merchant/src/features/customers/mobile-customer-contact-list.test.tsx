import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { CustomerDirectory } from '@b2b-saas-starter/capabilities/booking'
import {
  customerInitials,
  filterCustomerEntries
} from './mobile-customer-contact-model.ts'
import { MobileCustomerContactList } from './mobile-customer-contact-list.tsx'

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

const directory: CustomerDirectory = {
  timezone: 'UTC',
  entries: [
    {
      appointmentId: 'apt_mara',
      appointmentStatus: 'scheduled',
      scheduledAt: '2026-07-24T09:00:00.000Z',
      name: 'Mara Ionescu',
      email: 'mara@example.com',
      phone: '+40 700 000 001'
    },
    {
      appointmentId: 'apt_vlad',
      appointmentStatus: 'completed',
      scheduledAt: '2026-07-23T14:00:00.000Z',
      name: 'Vlad Pop',
      email: 'vlad@example.com',
      phone: null
    }
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
    expect(filterCustomerEntries(directory.entries, 'missing')).toEqual([])
  })

  it('builds stable two-letter contact initials', () => {
    expect(customerInitials('Mara Ionescu')).toBe('MI')
    expect(customerInitials(' Vlad ')).toBe('V')
    expect(customerInitials('')).toBe('?')
  })
})
