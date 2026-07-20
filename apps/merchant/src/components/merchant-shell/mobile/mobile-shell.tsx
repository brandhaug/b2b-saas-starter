import { Link, useLocation } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import type { MerchantDestination, MerchantShellSection } from '../navigation.tsx'
import { MobileHomeActions } from './mobile-home-actions.tsx'

type MobileShellProps = {
  readonly section: MerchantShellSection
  readonly destinations: readonly MerchantDestination[]
  readonly children: ReactNode
} & (
  | {
      readonly layout: 'sheet' | 'task'
      readonly title: string
      readonly description: string
    }
  | {
      readonly layout: 'home'
    }
)

export function MobileShell(props: MobileShellProps) {
  const { section, destinations, layout, children } = props
  const location = useLocation()
  const appointmentDate =
    typeof (location.search as { readonly date?: unknown }).date === 'string'
      ? (location.search as { readonly date: string }).date
      : undefined

  if (layout === 'home') {
    return (
      <main className="merchant-mobile min-h-dvh bg-background text-foreground">
        <section className="min-w-0 px-5 pt-[max(2rem,env(safe-area-inset-top))] pb-60">
          {children}
        </section>
        <MobileHomeActions destinations={destinations} />
      </main>
    )
  }

  return (
    <main className="merchant-mobile min-h-dvh overflow-hidden bg-black text-foreground">
      <section
        aria-labelledby="merchant-mobile-sheet-title"
        data-mobile-surface={layout}
        className="merchant-route-sheet mt-3 flex min-h-[calc(100dvh-0.75rem)] flex-col overflow-hidden rounded-t-[2rem] border-t bg-background"
      >
        <div className="mx-auto mt-2 h-1.5 w-12 shrink-0 rounded-full bg-muted-foreground/35" />
        <header className="sticky top-0 z-20 grid grid-cols-[3.5rem_1fr_3.5rem] items-center bg-background/92 px-3 pt-2 pb-3 backdrop-blur-xl">
          <Link
            to="/appointments"
            search={{ date: appointmentDate }}
            aria-label="Back to appointments"
            className="grid size-11 place-items-center rounded-full text-foreground active:bg-muted"
          >
            <ArrowLeft aria-hidden className="size-6" strokeWidth={2.5} />
          </Link>
          <h1
            id="merchant-mobile-sheet-title"
            className="truncate text-center text-base font-bold tracking-tight"
          >
            {props.title}
          </h1>
          <span aria-hidden />
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-[max(2rem,env(safe-area-inset-bottom))]">
          <p className="text-xs font-semibold tracking-[0.08em] text-primary uppercase">
            {section.kind === 'catalog' ? 'Merchant catalog' : 'Merchant App'}
          </p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {props.description}
          </p>
          {children}
        </div>
      </section>
    </main>
  )
}
