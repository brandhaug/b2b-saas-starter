import { Link } from '@tanstack/react-router'
import { Ellipsis, ListOrdered, Scissors, UserRound, UsersRound } from 'lucide-react'
import { useState } from 'react'
import type { ReactNode } from 'react'
import type { MerchantDestination } from '../navigation.tsx'
import { MobileNavigationSheet } from './mobile-navigation-sheet.tsx'

const visibleActions = [
  { to: '/walk-ins', icon: <ListOrdered aria-hidden /> },
  { to: '/customers', icon: <UsersRound aria-hidden /> },
  { to: '/services', icon: <Scissors aria-hidden /> },
  { to: '/providers', icon: <UserRound aria-hidden /> }
] as const

const homeRoutePaths = new Set<string>([
  '/appointments',
  ...visibleActions.map((action) => action.to)
])

export function MobileHomeActions({
  destinations
}: {
  readonly destinations: readonly MerchantDestination[]
}) {
  const [navigationOpen, setNavigationOpen] = useState(false)
  const destinationsByRoute = new Map(
    destinations.map((destination) => [destination.to, destination])
  )
  const moreDestinations = destinations.filter(
    (destination) => !homeRoutePaths.has(destination.to)
  )

  return (
    <>
      <nav
        aria-label="Merchant home actions"
        className="fixed inset-x-0 bottom-0 z-40 bg-gradient-to-t from-background via-background/98 to-transparent px-4 pt-12 pb-[max(1rem,env(safe-area-inset-bottom))]"
      >
        <div className="mx-auto grid max-w-md grid-cols-6 gap-2">
          {visibleActions.map((action, index) => {
            const destination = destinationsByRoute.get(action.to)
            if (!destination) return null
            return (
              <HomeAction
                key={destination.to}
                destination={destination}
                icon={action.icon}
                className={index < 2 ? 'col-span-3' : 'col-span-2'}
              />
            )
          })}
          <button
            type="button"
            aria-haspopup="dialog"
            aria-expanded={navigationOpen}
            className="col-span-2 grid min-h-[4.75rem] place-content-center gap-1 rounded-3xl border bg-card/95 px-3 text-sm font-bold text-foreground shadow-xl backdrop-blur active:scale-[0.98] active:bg-muted"
            onClick={() => setNavigationOpen(true)}
          >
            <Ellipsis aria-hidden className="mx-auto size-6" strokeWidth={2.5} />
            More
          </button>
        </div>
      </nav>
      <MobileNavigationSheet
        destinations={moreDestinations}
        open={navigationOpen}
        onRequestClose={() => setNavigationOpen(false)}
      />
    </>
  )
}

function HomeAction({
  destination,
  icon,
  className
}: {
  readonly destination: MerchantDestination
  readonly icon: ReactNode
  readonly className: string
}) {
  return (
    <Link
      to={destination.to}
      className={`${className} grid min-h-[4.75rem] place-content-center gap-1 rounded-3xl border bg-card/95 px-3 text-center text-sm font-bold text-foreground shadow-xl backdrop-blur active:scale-[0.98] active:bg-muted`}
    >
      <span className="mx-auto [&>svg]:size-6">{icon}</span>
      {destination.label}
    </Link>
  )
}
