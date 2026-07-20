import { Link, useLocation, useRouter } from '@tanstack/react-router'
import { Settings, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import type { MerchantDestination, MerchantShellSection } from '../navigation.tsx'
import { DesktopHomeActions, DesktopHomePlaceholder } from './desktop-home-actions.tsx'

export function DesktopShell({
  layout,
  section,
  destinations,
  title,
  description,
  children
}: {
  readonly layout: 'home' | 'modal'
  readonly section: MerchantShellSection
  readonly destinations: readonly MerchantDestination[]
  readonly title: string
  readonly description: string
  readonly children: ReactNode
}) {
  if (layout === 'home')
    return (
      <DesktopStage>
        <DesktopHomeCard
          destinations={destinations}
          title={title}
          description={description}
        >
          {children}
        </DesktopHomeCard>
      </DesktopStage>
    )

  return (
    <DesktopStage>
      <div aria-hidden="true" className="merchant-desktop-home-behind">
        <DesktopHomeCard
          destinations={destinations}
          title="Appointments"
          description="Your day at a glance."
          interactive={false}
        >
          <DesktopHomePlaceholder />
        </DesktopHomeCard>
      </div>
      <DesktopRouteModal section={section} title={title} description={description}>
        {children}
      </DesktopRouteModal>
    </DesktopStage>
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
      <header className="sticky top-0 z-20 grid grid-cols-[3rem_1fr_3rem] items-center border-b bg-background/92 px-4 py-3 backdrop-blur-xl">
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
          className="grid size-8 place-items-center justify-self-end rounded-full bg-muted text-muted-foreground hover:text-foreground"
        >
          <X aria-hidden className="size-4" strokeWidth={2.5} />
        </Link>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-8 py-6">
        <p className="text-xs font-semibold tracking-[0.08em] text-primary uppercase">
          {section.kind === 'catalog' ? 'Merchant catalog' : 'Merchant App'}
        </p>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
        {children}
      </div>
    </dialog>
  )
}

function DesktopStage({ children }: { readonly children: ReactNode }) {
  return (
    <main className="merchant-desktop-stage relative grid min-h-dvh place-items-center overflow-hidden p-6">
      <div aria-hidden className="merchant-desktop-orbit merchant-desktop-orbit-one" />
      <div aria-hidden className="merchant-desktop-orbit merchant-desktop-orbit-two" />
      {children}
    </main>
  )
}

function DesktopHomeCard({
  destinations,
  title,
  description,
  interactive = true,
  children
}: {
  readonly destinations: readonly MerchantDestination[]
  readonly title: string
  readonly description: string
  readonly interactive?: boolean
  readonly children: ReactNode
}) {
  return (
    <section
      aria-label="Merchant desktop home"
      className="merchant-desktop-home-card relative z-10 flex h-[750px] w-[448px] flex-col overflow-hidden rounded-3xl border border-white/10 text-white shadow-2xl"
    >
      <header className="flex h-16 shrink-0 items-center justify-between px-5">
        <span className="text-sm font-semibold tracking-tight">Merchant App</span>
        {interactive ? (
          <Link
            to="/settings"
            aria-label="Open Settings"
            className="grid size-10 place-items-center rounded-full bg-white/8 text-white/70 hover:bg-white/12 hover:text-white"
          >
            <Settings aria-hidden className="size-5" />
          </Link>
        ) : (
          <span className="grid size-10 place-items-center rounded-full bg-white/8 text-white/70">
            <Settings aria-hidden className="size-5" />
          </span>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-4">
        <p className="text-xs font-semibold tracking-[0.08em] text-primary uppercase">
          Today
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm leading-5 text-white/55">{description}</p>
        <div className="mt-5">{children}</div>
      </div>
      <div className="shrink-0 bg-gradient-to-t from-[#111720] via-[#111720]/98 to-transparent px-4 pt-3 pb-4">
        <DesktopHomeActions destinations={destinations} interactive={interactive} />
      </div>
    </section>
  )
}
