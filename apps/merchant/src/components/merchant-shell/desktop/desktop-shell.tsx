import { Link, useLocation, useRouter } from '@tanstack/react-router'
import { X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import {
  MerchantNavigation,
  type MerchantDestination,
  type MerchantShellSection
} from '../navigation.tsx'
import { MerchantShellHeader } from '../shell-header.tsx'

export function DesktopShell({
  layout,
  backgroundContent,
  section,
  destinations,
  title,
  description,
  children
}: {
  readonly layout: 'home' | 'modal'
  readonly backgroundContent?: ReactNode
  readonly section: MerchantShellSection
  readonly destinations: readonly MerchantDestination[]
  readonly title: string
  readonly description: string
  readonly children: ReactNode
}) {
  if (layout === 'home')
    return (
      <main className="min-h-dvh bg-background">
        <DesktopWorkspace
          section={{ kind: 'merchant' }}
          destinations={destinations}
          title={title}
          description={description}
        >
          {children}
        </DesktopWorkspace>
      </main>
    )

  return (
    <main className="relative min-h-dvh bg-background">
      <div aria-hidden="true" inert className="merchant-desktop-workspace-behind">
        <DesktopWorkspace
          section={{ kind: 'merchant' }}
          destinations={destinations}
          title="Appointments"
          description="Your Provider-oriented day view of accepted Appointment facts."
        >
          {backgroundContent ?? <DesktopAppointmentsBackdrop />}
        </DesktopWorkspace>
      </div>
      <DesktopRouteModal section={section} title={title} description={description}>
        {children}
      </DesktopRouteModal>
    </main>
  )
}

function DesktopRouteModal({
  section,
  title,
  description,
  children
}: {
  readonly section: MerchantShellSection
  readonly title: string
  readonly description: string
  readonly children: ReactNode
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const location = useLocation()
  const router = useRouter()
  const appointmentDate =
    typeof location.search === 'object' &&
    location.search !== null &&
    'date' in location.search &&
    typeof location.search.date === 'string'
      ? location.search.date
      : undefined

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  return (
    <dialog
      ref={dialogRef}
      aria-modal="true"
      aria-labelledby="merchant-desktop-modal-title"
      className="merchant-desktop-modal"
      onCancel={(event) => {
        event.preventDefault()
        void router.navigate({ to: '/appointments', search: { date: appointmentDate } })
      }}
    >
      <header className="sticky top-0 z-20 grid grid-cols-[3rem_1fr_3rem] items-center border-b bg-background/95 px-5 py-4 backdrop-blur-xl">
        <span aria-hidden />
        <h1
          id="merchant-desktop-modal-title"
          className="truncate text-center text-base font-semibold"
        >
          {title}
        </h1>
        <Link
          to="/appointments"
          search={{ date: appointmentDate }}
          aria-label={`Close ${title}`}
          className="grid size-8 place-items-center justify-self-end rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X aria-hidden className="size-4" strokeWidth={2.5} />
        </Link>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-7 py-6">
        <p className="text-xs font-semibold tracking-[0.08em] text-primary uppercase">
          {section.kind === 'catalog' ? 'Merchant catalog' : 'Merchant App'}
        </p>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
        {children}
      </div>
    </dialog>
  )
}

function DesktopWorkspace({
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
  return (
    <>
      <MerchantShellHeader section={section} presentation="desktop" />
      <div className="mx-auto grid max-w-7xl gap-8 px-6 py-8 md:grid-cols-[12rem_minmax(0,1fr)]">
        <nav aria-label="Merchant App" className="flex flex-col gap-2">
          <MerchantNavigation destinations={destinations} presentation="desktop" />
        </nav>
        <section className="min-w-0">
          <p className="text-xs font-medium text-primary">
            {section.kind === 'catalog' ? 'Merchant catalog' : 'Merchant App'}
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            {description}
          </p>
          <div className="mt-6">{children}</div>
        </section>
      </div>
    </>
  )
}

function DesktopAppointmentsBackdrop() {
  return (
    <div className="grid gap-6">
      <div className="flex items-end justify-between border-b pb-5">
        <div>
          <p className="text-sm font-medium">Today</p>
          <p className="mt-1 text-3xl font-semibold tracking-tight">Your schedule</p>
        </div>
        <span className="text-sm text-muted-foreground">Appointments</span>
      </div>
      <div className="grid gap-3">
        <div className="h-20 rounded-lg border bg-card" />
        <div className="h-20 rounded-lg border bg-card" />
        <div className="h-20 rounded-lg border bg-card" />
      </div>
    </div>
  )
}
