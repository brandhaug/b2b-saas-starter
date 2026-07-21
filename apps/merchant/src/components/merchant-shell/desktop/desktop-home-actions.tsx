import { Link } from '@tanstack/react-router'
import {
  CalendarClock,
  Ellipsis,
  ListOrdered,
  Scissors,
  UserRound,
  UsersRound
} from 'lucide-react'
import type { ReactNode } from 'react'
import type { MerchantDestination } from '../navigation.tsx'

const primaryActions = [
  { to: '/walk-ins', icon: <ListOrdered aria-hidden /> },
  { to: '/customers', icon: <UsersRound aria-hidden /> },
  { to: '/services', icon: <Scissors aria-hidden /> },
  { to: '/providers', icon: <UserRound aria-hidden /> }
] as const

const primaryPaths = new Set<string>([
  '/appointments',
  ...primaryActions.map((action) => action.to)
])

export function DesktopHomeActions({
  destinations,
  interactive = true
}: {
  readonly destinations: readonly MerchantDestination[]
  readonly interactive?: boolean
}) {
  const destinationsByRoute = new Map(
    destinations.map((destination) => [destination.to, destination])
  )
  const moreDestinations = destinations.filter(
    (destination) => !primaryPaths.has(destination.to)
  )

  return (
    <nav
      aria-label={interactive ? 'Merchant desktop home actions' : undefined}
      className="grid grid-cols-6 gap-2"
    >
      {primaryActions.map((action, index) => {
        const destination = destinationsByRoute.get(action.to)
        if (!destination) return null
        return (
          <DesktopAction
            key={destination.to}
            destination={destination}
            icon={action.icon}
            interactive={interactive}
            className={index < 2 ? 'col-span-3' : 'col-span-2'}
          />
        )
      })}
      {interactive ? (
        <details className="group relative col-span-2">
          <summary
            data-desktop-home-action="true"
            className="merchant-desktop-action grid h-[4.875rem] list-none place-content-center gap-1 rounded-3xl px-3 text-center text-sm font-semibold marker:content-none"
          >
            <Ellipsis aria-hidden className="mx-auto size-6" strokeWidth={2.25} />
            More
          </summary>
          <div className="absolute right-0 bottom-[calc(100%+0.625rem)] z-20 grid min-w-48 gap-1 rounded-xl border bg-card/98 p-2 text-card-foreground shadow-lg backdrop-blur-xl">
            {moreDestinations.map((destination) => (
              <Link
                key={destination.to}
                to={destination.to}
                className="flex min-h-11 items-center justify-between rounded-lg px-3 text-sm font-semibold hover:bg-accent"
              >
                {destination.label}
                <span aria-hidden>›</span>
              </Link>
            ))}
          </div>
        </details>
      ) : (
        <span className="merchant-desktop-action col-span-2 grid h-[4.875rem] place-content-center gap-1 rounded-3xl px-3 text-center text-sm font-semibold">
          <Ellipsis aria-hidden className="mx-auto size-6" strokeWidth={2.25} />
          More
        </span>
      )}
    </nav>
  )
}

function DesktopAction({
  destination,
  icon,
  interactive,
  className
}: {
  readonly destination: MerchantDestination
  readonly icon: ReactNode
  readonly interactive: boolean
  readonly className: string
}) {
  const styles = `${className} merchant-desktop-action grid h-[4.875rem] place-content-center gap-1 rounded-3xl px-3 text-center text-sm font-semibold`
  if (!interactive)
    return (
      <span className={styles}>
        <span className="mx-auto [&>svg]:size-6">{icon}</span>
        {destination.label}
      </span>
    )

  return (
    <Link data-desktop-home-action="true" to={destination.to} className={styles}>
      <span className="mx-auto [&>svg]:size-6">{icon}</span>
      {destination.label}
    </Link>
  )
}

export function DesktopHomePlaceholder() {
  return (
    <div className="grid gap-3" aria-hidden>
      <div className="flex items-end justify-between">
        <span className="text-6xl font-bold tracking-[-0.08em]">20</span>
        <span className="text-right text-sm font-semibold text-muted-foreground">
          Your day
          <br />
          at a glance
        </span>
      </div>
      <div className="h-16 rounded-xl bg-muted" />
      <div className="flex items-center gap-3 border-b py-3">
        <CalendarClock className="size-5 text-muted-foreground" />
        <span className="text-sm font-semibold">Today’s appointments</span>
      </div>
      <div className="h-12 rounded-lg bg-muted/80" />
      <div className="h-12 rounded-lg bg-muted/80" />
    </div>
  )
}
