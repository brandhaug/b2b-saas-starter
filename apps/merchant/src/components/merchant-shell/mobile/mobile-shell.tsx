import type { ReactNode } from 'react'
import type { MerchantDestination, MerchantShellSection } from '../navigation.tsx'
import { MerchantShellHeader } from '../shell-header.tsx'
import { MobileBottomDock } from './mobile-bottom-dock.tsx'

export function MobileShell({
  section,
  destinations,
  title,
  description,
  heading,
  children
}: {
  readonly section: MerchantShellSection
  readonly destinations: readonly MerchantDestination[]
  readonly title: string
  readonly description: string
  readonly heading: 'shell' | 'screen'
  readonly children: ReactNode
}) {
  return (
    <main className="merchant-mobile min-h-dvh bg-background pb-32 text-foreground">
      {heading === 'shell' ? (
        <MerchantShellHeader section={section} presentation="mobile" />
      ) : null}
      <section
        className={`min-w-0 px-5 ${heading === 'screen' ? 'pt-[max(2rem,env(safe-area-inset-top))]' : 'py-7'}`}
      >
        {heading === 'shell' ? (
          <>
            <p className="text-xs font-medium text-primary">
              {section.kind === 'catalog' ? 'Merchant catalog' : 'Merchant App'}
            </p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight">{title}</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {description}
            </p>
          </>
        ) : null}
        {children}
      </section>
      <MobileBottomDock destinations={destinations} />
    </main>
  )
}
