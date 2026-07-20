import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import {
  MerchantNavigation,
  type MerchantDestination,
  type MerchantShellSection
} from '../navigation.tsx'

export function DesktopShell({
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
    <main className="min-h-dvh bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
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
          ) : (
            <span className="text-xs font-medium text-muted-foreground">
              Operations
            </span>
          )}
        </div>
      </header>
      <div className="mx-auto grid max-w-7xl gap-8 px-6 py-8 md:grid-cols-[12rem_minmax(0,1fr)]">
        <nav aria-label="Merchant App" className="flex flex-col gap-2">
          <MerchantNavigation destinations={destinations} presentation="desktop" />
        </nav>
        <section className="min-w-0">
          <p className="text-xs font-medium text-primary">
            {section.kind === 'catalog' ? 'Merchant catalog' : 'Merchant operations'}
          </p>
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
