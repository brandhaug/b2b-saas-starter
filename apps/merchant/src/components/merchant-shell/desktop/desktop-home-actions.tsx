import { Link } from '@tanstack/react-router'
import {
  Ellipsis,
  ListOrdered,
  Plus,
  Scissors,
  UserRound,
  UsersRound
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { merchantOverlayNavigationState } from '@/lib/merchant-home-route.ts'
import type { MerchantDestination } from '../navigation.tsx'
import { NewAppointmentDialog } from '../mobile/mobile-new-appointment-sheet.tsx'

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
  appointmentDate,
  interactive = true
}: {
  readonly destinations: readonly MerchantDestination[]
  readonly appointmentDate: string | undefined
  readonly interactive?: boolean
}) {
  const [newAppointmentOpen, setNewAppointmentOpen] = useState(false)
  const destinationsByRoute = new Map(
    destinations.map((destination) => [destination.to, destination])
  )
  const moreDestinations = destinations.filter(
    (destination) => !primaryPaths.has(destination.to)
  )

  return (
    <>
      <nav
        aria-label={interactive ? 'Merchant desktop home actions' : undefined}
        className="grid grid-cols-6 gap-2"
      >
        {interactive ? (
          <button
            type="button"
            aria-label="New appointment"
            aria-haspopup="dialog"
            aria-expanded={newAppointmentOpen}
            data-desktop-home-action="true"
            data-desktop-home-create-action="new-appointment"
            className="merchant-desktop-action col-span-6 flex h-14 items-center justify-center gap-2 rounded-3xl px-4 text-sm font-semibold shadow-alyn"
            onClick={() => setNewAppointmentOpen(true)}
          >
            <Plus aria-hidden className="size-5" strokeWidth={2.25} />
            New appointment
          </button>
        ) : (
          <span className="merchant-desktop-action col-span-6 flex h-14 items-center justify-center gap-2 rounded-3xl px-4 text-sm font-semibold">
            <Plus aria-hidden className="size-5" strokeWidth={2.25} />
            New appointment
          </span>
        )}
        {primaryActions.map((action, index) => {
          const destination = destinationsByRoute.get(action.to)
          if (!destination) return null
          return (
            <DesktopAction
              key={destination.to}
              destination={destination}
              icon={action.icon}
              appointmentDate={appointmentDate}
              interactive={interactive}
              className={index < 2 ? 'col-span-3' : 'col-span-2'}
            />
          )
        })}
        {interactive ? (
          <details className="group relative col-span-2">
            <summary
              data-desktop-home-action="true"
              className="merchant-desktop-action grid h-[4.875rem] list-none place-content-center gap-1 rounded-3xl px-3 text-center text-sm font-semibold marker:content-none shadow-alyn"
            >
              <Ellipsis aria-hidden className="mx-auto size-6" strokeWidth={2.25} />
              More
            </summary>
            <div className="absolute right-0 bottom-[calc(100%+0.625rem)] z-20 grid min-w-48 gap-1 rounded-xl border bg-card/98 p-2 text-card-foreground backdrop-blur-xl">
              {moreDestinations.map((destination) => (
                <Link
                  key={destination.to}
                  to={destination.to}
                  search={appointmentDate ? { date: appointmentDate } : {}}
                  state={(previous) =>
                    merchantOverlayNavigationState(previous, appointmentDate)
                  }
                  viewTransition={false}
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
      <NewAppointmentDialog
        open={newAppointmentOpen}
        presentation="desktop"
        appointmentDate={appointmentDate}
        onRequestClose={() => setNewAppointmentOpen(false)}
      />
    </>
  )
}

function DesktopAction({
  destination,
  icon,
  appointmentDate,
  interactive,
  className
}: {
  readonly destination: MerchantDestination
  readonly icon: ReactNode
  readonly appointmentDate: string | undefined
  readonly interactive: boolean
  readonly className: string
}) {
  const styles = `${className} merchant-desktop-action grid h-[4.875rem] place-content-center gap-1 rounded-3xl px-3 text-center text-sm font-semibold shadow-alyn`
  if (!interactive)
    return (
      <span className={styles}>
        <span className="mx-auto [&>svg]:size-6">{icon}</span>
        {destination.label}
      </span>
    )

  return (
    <Link
      data-desktop-home-action="true"
      to={destination.to}
      search={appointmentDate ? { date: appointmentDate } : {}}
      state={(previous) => merchantOverlayNavigationState(previous, appointmentDate)}
      viewTransition={false}
      className={styles}
    >
      <span className="mx-auto [&>svg]:size-6">{icon}</span>
      {destination.label}
    </Link>
  )
}
