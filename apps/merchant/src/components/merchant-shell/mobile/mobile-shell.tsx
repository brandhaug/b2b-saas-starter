import type { ReactNode } from 'react'
import type { MerchantDestination, MerchantShellSection } from '../navigation.tsx'
import { MerchantShellHeader } from '../shell-header.tsx'
import { MobileBottomDock } from './mobile-bottom-dock.tsx'

type MobileShellProps = {
  readonly section: MerchantShellSection
  readonly destinations: readonly MerchantDestination[]
  readonly children: ReactNode
} & (
  | {
      readonly layout: 'standard'
      readonly title: string
      readonly description: string
    }
  | {
      readonly layout: 'immersive'
    }
)

export function MobileShell(props: MobileShellProps) {
  const { section, destinations, layout, children } = props

  return (
    <main className="merchant-mobile min-h-dvh bg-background pb-32 text-foreground">
      {layout === 'standard' ? (
        <MerchantShellHeader section={section} presentation="mobile" />
      ) : null}
      <section
        className={`min-w-0 px-5 ${layout === 'immersive' ? 'pt-[max(2rem,env(safe-area-inset-top))]' : 'py-7'}`}
      >
        {layout === 'standard' ? (
          <>
            <p className="text-xs font-medium text-primary">
              {section.kind === 'catalog' ? 'Merchant catalog' : 'Merchant App'}
            </p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight">{props.title}</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {props.description}
            </p>
          </>
        ) : null}
        {children}
      </section>
      <MobileBottomDock destinations={destinations} />
    </main>
  )
}
