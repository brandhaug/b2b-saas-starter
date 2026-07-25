import { Link } from '@tanstack/react-router'
import {
  CalendarClock,
  ChevronRight,
  ListOrdered,
  Scissors,
  Settings,
  UserRound,
  UsersRound
} from 'lucide-react'
import type { ComponentType } from 'react'
import type { MerchantDestination } from '../navigation.tsx'
import { mobileSheetNavigationState } from './mobile-sheet-gesture.ts'

const destinationIcons: Partial<
  Record<
    MerchantDestination['to'],
    ComponentType<{ className?: string; strokeWidth?: number }>
  >
> = {
  '/walk-ins': ListOrdered,
  '/customers': UsersRound,
  '/services': Scissors,
  '/providers': UserRound,
  '/availability': CalendarClock,
  '/settings': Settings
}

export function MobileNavigationMenu({
  destinations,
  appointmentDate
}: {
  readonly destinations: readonly MerchantDestination[]
  readonly appointmentDate: string | undefined
}) {
  return (
    <nav
      aria-label="Settings navigation"
      className="overflow-hidden rounded-2xl border bg-muted/35"
    >
      {destinations.map((destination) => {
        const Icon = destinationIcons[destination.to] ?? Settings
        return (
          <Link
            key={destination.to}
            to={destination.to}
            viewTransition={false}
            state={(previous) => mobileSheetNavigationState(previous, appointmentDate)}
            search={appointmentDate ? { date: appointmentDate } : {}}
            className="flex min-h-14 items-center gap-3 border-b border-border/70 px-4 text-[0.9375rem] leading-[1.375rem] font-semibold text-foreground last:border-b-0 active:bg-muted/60"
          >
            <span className="grid size-[1.375rem] shrink-0 place-items-center text-muted-foreground">
              <Icon aria-hidden className="size-[1.375rem]" strokeWidth={1.8} />
            </span>
            <span className="min-w-0 flex-1">{destination.label}</span>
            <ChevronRight
              aria-hidden
              className="size-[1.125rem] shrink-0 text-muted-foreground"
              strokeWidth={1.8}
            />
          </Link>
        )
      })}
    </nav>
  )
}
