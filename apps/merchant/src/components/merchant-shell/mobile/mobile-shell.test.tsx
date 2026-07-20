import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { MerchantDestination } from '../navigation.tsx'
import { MobileShell } from './mobile-shell.tsx'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    activeProps: _activeProps,
    search,
    ...props
  }: {
    children: ReactNode
    to: string
    activeProps?: unknown
    search?: unknown
  }) => (
    <a
      href={to}
      data-search-date={(search as { readonly date?: string } | undefined)?.date}
      {...props}
    >
      {children}
    </a>
  ),
  useLocation: () => ({ search: { date: '2026-07-27' } }),
  useRouter: () => ({ history: { back: vi.fn() } })
}))

const destinations: readonly MerchantDestination[] = [
  { label: 'Appointments', to: '/appointments' },
  { label: 'Walk-ins', to: '/walk-ins' },
  { label: 'Customers', to: '/customers' },
  { label: 'Services', to: '/services' },
  { label: 'Providers', to: '/providers' },
  { label: 'Availability', to: '/availability' },
  { label: 'Settings', to: '/settings' }
]

type TestShellProps =
  | { readonly layout: 'home' }
  | {
      readonly layout: 'sheet' | 'task'
      readonly title: string
      readonly description: string
    }

function renderShell(props: TestShellProps) {
  const shell =
    props.layout === 'home' ? (
      <MobileShell
        layout="home"
        section={{ kind: 'merchant' }}
        destinations={destinations}
      >
        <p>Route content</p>
      </MobileShell>
    ) : (
      <MobileShell
        layout={props.layout}
        title={props.title}
        description={props.description}
        section={{ kind: 'merchant' }}
        destinations={destinations}
      >
        <p>Route content</p>
      </MobileShell>
    )

  return renderToStaticMarkup(shell)
}

describe('MobileShell', () => {
  it('presents the appointments route as an immersive home with five direct actions', () => {
    const html = renderShell({ layout: 'home' })
    const homeActions = html.match(
      /<nav aria-label="Merchant home actions"[\s\S]*?<\/nav>/
    )?.[0]
    const moreNavigation = html.match(
      /<nav aria-label="Merchant navigation"[\s\S]*?<\/nav>/
    )?.[0]

    expect(homeActions).toBeDefined()
    expect(homeActions?.match(/<a /g)).toHaveLength(4)
    expect(homeActions?.match(/<button/g)).toHaveLength(1)
    expect(homeActions).toMatch(
      /Walk-ins[\s\S]*Customers[\s\S]*Services[\s\S]*Providers[\s\S]*More/
    )
    expect(homeActions?.match(/col-span-3/g)).toHaveLength(2)
    expect(homeActions?.match(/col-span-2/g)).toHaveLength(3)
    expect(moreNavigation).toContain('Availability')
    expect(moreNavigation).toContain('Settings')
    expect(moreNavigation).not.toMatch(
      /Appointments|Walk-ins|Customers|Services|Providers/
    )
    expect(html).not.toContain('aria-modal="true"')
  })

  it('presents secondary routes as a dismissible mobile sheet without the home actions', () => {
    const html = renderShell({
      layout: 'sheet',
      title: 'Customers',
      description: 'Customer history'
    })

    expect(html).toContain('<section')
    expect(html).not.toContain('aria-modal="true"')
    expect(html).toContain('aria-label="Back to appointments"')
    expect(html).toContain('data-search-date="2026-07-27"')
    expect(html).toContain('Customers')
    expect(html).not.toContain('aria-label="Merchant home actions"')
  })
})
