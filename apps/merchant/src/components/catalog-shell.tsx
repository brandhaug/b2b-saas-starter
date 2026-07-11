import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import type { MerchantCatalogSnapshot } from '@b2b-saas-starter/capabilities/merchant-catalog'
import { catalogDestinations } from '@/lib/catalog-workflow.ts'

export function CatalogShell({
  catalog,
  title,
  description,
  children
}: {
  readonly catalog: MerchantCatalogSnapshot
  readonly title: string
  readonly description: string
  readonly children: ReactNode
}) {
  return (
    <main className="min-h-dvh bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Link
            to="/"
            className="inline-flex min-h-9 items-center font-semibold tracking-tight"
          >
            Merchant App
          </Link>
          <span className="inline-flex h-[22px] items-center rounded-md bg-secondary px-2 py-1 text-xs font-medium capitalize text-secondary-foreground">
            {catalog.presentation}
          </span>
        </div>
      </header>
      <div className="mx-auto grid max-w-7xl gap-8 px-6 py-8 md:grid-cols-[12rem_minmax(0,1fr)]">
        <nav aria-label="Catalog" className="flex gap-2 md:flex-col">
          {catalogDestinations(catalog.presentation).map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeProps={{ className: 'bg-card text-foreground shadow-sm' }}
              inactiveProps={{ className: 'text-muted-foreground hover:bg-card' }}
              className="rounded-md px-3 py-2 text-sm font-medium"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <section className="min-w-0">
          <p className="text-xs font-medium text-primary">Merchant catalog</p>
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
