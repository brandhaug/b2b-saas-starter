import { Link } from '@tanstack/react-router'
import { CalendarDays, Menu, Plus } from 'lucide-react'
import type { MerchantDestination } from '../navigation.tsx'
import { MobileNavigationSheet } from './mobile-navigation-sheet.tsx'

export function MobileBottomDock({
  destinations
}: {
  readonly destinations: readonly MerchantDestination[]
}) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 flex items-end justify-between bg-gradient-to-t from-background via-background/95 to-transparent px-5 pt-12 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <Link
        to="/appointments"
        search={{ date: undefined }}
        aria-label="Today"
        className="grid size-14 place-items-center rounded-full border bg-card text-muted-foreground shadow-xl"
      >
        <CalendarDays className="size-6" strokeWidth={2.5} />
      </Link>

      <details className="group relative">
        <summary
          aria-label="Quick actions"
          className="grid h-16 w-28 list-none place-items-center rounded-full border bg-card text-muted-foreground shadow-xl marker:content-none"
        >
          <Plus className="size-8 transition-transform group-open:rotate-45" />
        </summary>
        <div className="absolute bottom-[calc(100%+1rem)] left-1/2 grid min-w-52 -translate-x-1/2 gap-1 rounded-3xl border bg-card p-2 shadow-2xl">
          <Link
            to="/walk-ins"
            className="rounded-2xl px-4 py-3 text-sm font-bold text-foreground hover:bg-muted"
          >
            Open Walk-in Queue
          </Link>
          <Link
            to="/services"
            className="rounded-2xl px-4 py-3 text-sm font-bold text-foreground hover:bg-muted"
          >
            Manage Services
          </Link>
        </div>
      </details>

      <details className="group relative">
        <summary
          aria-label="Open Merchant navigation"
          className="grid size-14 list-none place-items-center rounded-full border bg-card text-muted-foreground shadow-xl marker:content-none"
        >
          <Menu className="size-6" strokeWidth={2.5} />
        </summary>
        <MobileNavigationSheet destinations={destinations} />
      </details>
    </div>
  )
}
