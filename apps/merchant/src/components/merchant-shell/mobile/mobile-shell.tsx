import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import {
  MerchantNavigation,
  type MerchantDestination,
  type MerchantShellSection
} from '../navigation.tsx'

export function MobileShell({
  section,
  destinations,
  title,
  description,
  children
}: {
  readonly section: MerchantShellSection
  readonly destinations: readonly MerchantDestination[]
  readonly title: string
  readonly description: string
  readonly children: ReactNode
}) {
  return (
    <main className="min-h-dvh bg-background pb-24">
      <header className="border-b bg-card px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          {section.kind === 'operations' ? (
            <Link
              to="/appointments"
              search={{ date: undefined }}
              className="font-semibold tracking-tight"
            >
              Merchant App
            </Link>
          ) : (
            <Link to="/" className="font-semibold tracking-tight">
              Merchant App
            </Link>
          )}
          {section.kind === 'catalog' ? (
            <span className="rounded-md bg-secondary px-2 py-1 text-xs font-medium capitalize text-secondary-foreground">
              {section.presentation}
            </span>
          ) : null}
        </div>
      </header>
      <section className="min-w-0 px-4 py-6">
        <p className="text-xs font-medium text-primary">
          {section.kind === 'catalog' ? 'Merchant catalog' : 'Merchant operations'}
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
        {children}
      </section>
      <nav
        aria-label="Merchant App"
        className="fixed inset-x-0 bottom-0 z-40 grid border-t bg-card/95 px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur"
        style={{
          gridTemplateColumns: `repeat(${destinations.length}, minmax(0, 1fr))`
        }}
      >
        <MerchantNavigation destinations={destinations} presentation="mobile" />
      </nav>
    </main>
  )
}
