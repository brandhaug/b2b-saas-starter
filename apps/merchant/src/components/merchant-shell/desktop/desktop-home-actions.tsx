import { Link } from '@tanstack/react-router'
import { ListOrdered, Plus, UsersRound } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { merchantOverlayNavigationState } from '@/lib/merchant-home-route.ts'
import type { MerchantDestination } from '../navigation.tsx'
import { NewAppointmentDialog } from '../mobile/mobile-new-appointment-sheet.tsx'

const walkInsAction = { to: '/walk-ins', icon: <ListOrdered aria-hidden /> } as const
const customersAction = {
  to: '/customers',
  icon: <UsersRound aria-hidden />
} as const

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
  const walkIns = destinationsByRoute.get(walkInsAction.to)
  const customers = destinationsByRoute.get(customersAction.to)

  return (
    <>
      <nav
        aria-label={interactive ? 'Merchant desktop home actions' : undefined}
        className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)_minmax(0,1fr)] gap-2"
      >
        {walkIns ? (
          <DesktopAction
            destination={walkIns}
            icon={walkInsAction.icon}
            appointmentDate={appointmentDate}
            interactive={interactive}
          />
        ) : (
          <span aria-hidden />
        )}
        {interactive ? (
          <button
            type="button"
            aria-label="New appointment"
            aria-haspopup="dialog"
            aria-expanded={newAppointmentOpen}
            data-desktop-home-action="true"
            data-desktop-home-create-action="new-appointment"
            className="merchant-desktop-action flex h-16 min-w-0 items-center justify-center gap-2 rounded-3xl px-3 text-sm font-semibold shadow-alyn"
            onClick={() => setNewAppointmentOpen(true)}
          >
            <Plus aria-hidden className="size-5" strokeWidth={2.25} />
            New appointment
          </button>
        ) : (
          <span className="merchant-desktop-action flex h-16 min-w-0 items-center justify-center gap-2 rounded-3xl px-3 text-sm font-semibold">
            <Plus aria-hidden className="size-5" strokeWidth={2.25} />
            New appointment
          </span>
        )}
        {customers ? (
          <DesktopAction
            destination={customers}
            icon={customersAction.icon}
            appointmentDate={appointmentDate}
            interactive={interactive}
          />
        ) : (
          <span aria-hidden />
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
  interactive
}: {
  readonly destination: MerchantDestination
  readonly icon: ReactNode
  readonly appointmentDate: string | undefined
  readonly interactive: boolean
}) {
  const styles =
    'merchant-desktop-action grid h-16 min-w-0 place-content-center gap-1 rounded-3xl px-2 text-center text-xs font-semibold shadow-alyn'
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
