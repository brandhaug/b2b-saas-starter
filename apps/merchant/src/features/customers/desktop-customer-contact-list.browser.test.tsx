// @vitest-environment jsdom

import type { ReactNode } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CustomerDirectory } from '@b2b-saas-starter/capabilities/booking'
import { DesktopCustomerContactList } from './desktop-customer-contact-list.tsx'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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
  timezone: 'Europe/Bucharest',
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

let root: Root | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.innerHTML = ''
})

describe('DesktopCustomerContactList', () => {
  it('renders a searchable contact list instead of a table', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () =>
      root?.render(<DesktopCustomerContactList directory={directory} />)
    )

    const search = container.querySelector<HTMLInputElement>(
      'input[placeholder="Search customers"]'
    )
    expect(
      container.querySelector('[data-desktop-customer-directory="true"]')
    ).not.toBeNull()
    expect(container.querySelector('table')).toBeNull()
    expect(
      container.querySelectorAll('[data-desktop-customer-row="true"]')
    ).toHaveLength(2)
    expect(container.textContent).toContain('Mara Ionescu')
    expect(container.textContent).toContain('Vlad Pop')

    await act(async () => {
      if (!search) return
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value'
      )?.set
      setter?.call(search, 'mara')
      search.dispatchEvent(new Event('input', { bubbles: true }))
    })

    expect(
      container.querySelectorAll('[data-desktop-customer-row="true"]')
    ).toHaveLength(1)
    expect(container.textContent).toContain('Mara Ionescu')
    expect(container.textContent).not.toContain('Vlad Pop')
  })
})
