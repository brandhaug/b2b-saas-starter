// @vitest-environment jsdom

import type { ReactNode } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CustomerRecord } from '@b2b-saas-starter/capabilities/customer-directory'
import { DesktopCustomerContactList } from './desktop-customer-contact-list.tsx'
import type { CustomerDirectoryView } from './customer-contact-model.ts'

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
    record(
      'cur_mara',
      'Mara Ionescu',
      'mara@example.com',
      '+40 700 000 001',
      '2026-07-24T09:00:00.000Z'
    ),
    record('cur_vlad', 'Vlad Pop', 'vlad@example.com', null, '2026-07-23T14:00:00.000Z')
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
