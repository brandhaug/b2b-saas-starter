import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'

const destinations = [
  { label: 'Appointments', to: '/appointments' as const },
  { label: 'Customers', to: '/customers' as const },
  { label: 'Services', to: '/services' as const },
  { label: 'Providers', to: '/providers' as const },
  { label: 'Availability', to: '/availability' as const }
]

export function OperationsShell({
  title,
  description,
  children
}: {
  readonly title: string
  readonly description: string
  readonly children: ReactNode
}) {
  return (
    <main className="min-h-dvh bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Link
            to="/appointments"
            search={{ date: new Date().toISOString().slice(0, 10) }}
            className="font-semibold tracking-tight"
          >
            Merchant App
          </Link>
          <span className="text-xs font-medium text-muted-foreground">Operations</span>
        </div>
      </header>
      <div className="mx-auto grid max-w-7xl gap-8 px-6 py-8 md:grid-cols-[12rem_minmax(0,1fr)]">
        <nav
          aria-label="Merchant operations"
          className="flex flex-wrap gap-2 md:flex-col"
        >
          {destinations.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              search={(previous) => previous}
              activeProps={{
                className: 'bg-sidebar-accent text-sidebar-accent-foreground'
              }}
              inactiveProps={{
                className: 'text-sidebar-foreground hover:bg-sidebar-accent'
              }}
              className="rounded-md px-3 py-2 text-sm font-medium"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <section className="min-w-0">
          <p className="text-xs font-medium text-primary">Merchant operations</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            {description}
          </p>
          {children}
        </section>
      </div>
    </main>
  )
}
