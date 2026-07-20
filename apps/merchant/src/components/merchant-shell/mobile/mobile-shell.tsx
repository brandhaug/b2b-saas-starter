import type { ReactNode } from 'react'
import {
  MerchantNavigation,
  type MerchantDestination,
  type MerchantShellSection
} from '../navigation.tsx'
import { MerchantShellHeader } from '../shell-header.tsx'
import { MobileMoreMenu } from './mobile-more-menu.tsx'

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
  const primaryDestinations =
    destinations.length > 5 ? destinations.slice(0, 4) : destinations
  const moreDestinations = destinations.length > 5 ? destinations.slice(4) : []
  const navigationColumns =
    primaryDestinations.length + (moreDestinations.length > 0 ? 1 : 0)
  return (
    <main className="min-h-dvh bg-background pb-24">
      <MerchantShellHeader section={section} presentation="mobile" />
      <section className="min-w-0 px-4 py-6">
        <p className="text-xs font-medium text-primary">
          {section.kind === 'catalog' ? 'Merchant catalog' : 'Merchant App'}
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
        {children}
      </section>
      <nav
        aria-label="Merchant App"
        className="fixed inset-x-0 bottom-0 z-40 grid border-t bg-card/95 px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur"
        style={{
          gridTemplateColumns: `repeat(${navigationColumns}, minmax(0, 1fr))`
        }}
      >
        <MerchantNavigation destinations={primaryDestinations} presentation="mobile" />
        {moreDestinations.length > 0 ? (
          <MobileMoreMenu destinations={moreDestinations} />
        ) : null}
      </nav>
    </main>
  )
}
