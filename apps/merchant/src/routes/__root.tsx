import type { ComponentProps, ReactNode } from 'react'
import { QueryClientProvider, useQuery, type QueryClient } from '@tanstack/react-query'
import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
  redirect,
  Scripts,
  useLocation,
  useRouter
} from '@tanstack/react-router'
import { ImpersonationBanner } from '@/components/impersonation-banner.tsx'
import { MerchantPwaRegistration } from '@/components/merchant-pwa-registration.tsx'
import { MerchantThemeSync } from '@/components/merchant-theme-sync.tsx'
import { DevFpsPill } from '@/components/dev-fps-pill.tsx'
import {
  getImpersonationLifecycle,
  stopImpersonation
} from '@/lib/server/impersonation-lifecycle.ts'
import {
  MerchantPresentationProvider,
  useMerchantPresentation
} from '@/components/merchant-shell/merchant-presentation.tsx'
import { MerchantShell } from '@/components/merchant-shell/index.ts'
import { merchantDestinations } from '@/components/merchant-shell/navigation.tsx'
import { MobileNavigationMenu } from '@/components/merchant-shell/mobile/mobile-navigation-menu.tsx'
import { MobileShell } from '@/components/merchant-shell/mobile/mobile-shell.tsx'
import {
  MobileSheetStackProvider,
  useMobileSheetStack,
  type MobileSheetDescriptor
} from '@/components/merchant-shell/mobile/mobile-sheet-stack.tsx'
import { MobileAppointmentsScreen } from '@/features/appointments/mobile/mobile-appointments-screen.tsx'
import { appointmentDayTarget } from '@/features/appointments/mobile/week-navigation.ts'
import { decodeAppointmentCalendarSearch } from '@/lib/appointment-calendar-date.ts'
import {
  isMerchantOverlayPath,
  merchantHomeDateFromNavigationState,
  shouldRenderMerchantHome
} from '@/lib/merchant-home-route.ts'
import type { MerchantPresentation } from '@/lib/merchant-presentation.ts'
import {
  MERCHANT_PWA_VIEWPORT,
  merchantPwaHeadLinks,
  merchantPwaHeadMeta
} from '@/lib/merchant-pwa.ts'
import {
  merchantHomeCalendarQuery,
  merchantPublicBookingUrlQuery
} from '@/lib/merchant-home-queries.ts'
import { merchantThemeBootScript } from '@/lib/merchant-theme.ts'
import { getMerchantPresentation } from '@/lib/server/merchant-presentation.ts'
import { getMerchantViewer } from '@/lib/server/merchant-session.ts'
import onestLatinFont from '@fontsource-variable/onest/files/onest-latin-wght-normal.woff2?url'
import appCss from '../index.css?url'

export const merchantHeadLinks = [
  ...merchantPwaHeadLinks,
  { rel: 'stylesheet', href: appCss },
  {
    rel: 'preload',
    href: onestLatinFont,
    as: 'font',
    type: 'font/woff2',
    crossOrigin: 'anonymous'
  }
] satisfies ComponentProps<'link'>[]

type MerchantRouterContext = {
  readonly queryClient: QueryClient
}

export const Route = createRootRouteWithContext<MerchantRouterContext>()({
  loader: async () => {
    const [lifecycle, presentation, viewer] = await Promise.all([
      getImpersonationLifecycle(),
      getMerchantPresentation(),
      getMerchantViewer()
    ])
    if (lifecycle?.state === 'terminated') throw redirect({ href: lifecycle.returnTo })
    return {
      impersonationLifecycle: lifecycle,
      merchantPresentation: presentation,
      merchantViewer: viewer
    }
  },
  shouldReload: ({ cause }) => cause === 'enter',
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { title: 'Merchant App' },
      {
        name: 'description',
        content: 'The authenticated Merchant App for the Booking Product.'
      },
      ...merchantPwaHeadMeta
    ],
    links: merchantHeadLinks
  }),
  component: RootComponent
})

function RootComponent() {
  const {
    impersonationLifecycle: lifecycle,
    merchantPresentation: presentation,
    merchantViewer: viewer
  } = Route.useLoaderData()
  const { queryClient } = Route.useRouteContext()
  const router = useRouter()
  const location = useLocation()
  const merchantOverlayOpen = isMerchantOverlayPath(location.pathname)
  return (
    <RootDocument presentation={presentation}>
      <QueryClientProvider client={queryClient}>
        {lifecycle?.state === 'active' ? (
          <div
            aria-hidden={merchantOverlayOpen || undefined}
            inert={merchantOverlayOpen || undefined}
          >
            <ImpersonationBanner
              presentation={lifecycle}
              onExpired={() => {
                void router.invalidate()
              }}
              onStop={async () => {
                const stopped = await stopImpersonation()
                if (stopped?.state === 'terminated')
                  window.location.assign(stopped.returnTo)
              }}
            />
          </div>
        ) : null}
        <MerchantPresentationProvider presentation={presentation}>
          <MobileSheetStackProvider>
            {shouldRenderMerchantHome(location.pathname) ? (
              <MerchantHomeLayer
                href={location.href}
                search={location.search}
                state={location.state}
                overlayOpen={merchantOverlayOpen}
                viewerName={viewer?.name}
              />
            ) : null}
            <MerchantMobileSheetOutlet
              pathname={location.pathname}
              appointmentDate={merchantHomeDate(location.search, location.state)}
              overlayOpen={merchantOverlayOpen}
            >
              <Outlet />
            </MerchantMobileSheetOutlet>
          </MobileSheetStackProvider>
        </MerchantPresentationProvider>
      </QueryClientProvider>
    </RootDocument>
  )
}

function merchantHomeDate(search: unknown, state: unknown) {
  try {
    return (
      decodeAppointmentCalendarSearch(search).date ??
      merchantHomeDateFromNavigationState(state)
    )
  } catch {
    return undefined
  }
}

function MerchantHomeLayer({
  href,
  search,
  state,
  overlayOpen,
  viewerName
}: {
  readonly href: string
  readonly search: unknown
  readonly state: unknown
  readonly overlayOpen: boolean
  readonly viewerName: string | undefined
}) {
  const requestedDate = merchantHomeDate(search, state)
  const calendar = useQuery(merchantHomeCalendarQuery(requestedDate, href))
  const bookingUrl = useQuery(merchantPublicBookingUrlQuery())
  const selectedDate = requestedDate ?? calendar.data?.date
  const previousDate = selectedDate
    ? appointmentDayTarget(selectedDate, 'previous')
    : undefined
  const nextDate = selectedDate ? appointmentDayTarget(selectedDate, 'next') : undefined
  const previousCalendar = useQuery({
    ...merchantHomeCalendarQuery(previousDate, href),
    enabled: previousDate !== undefined
  })
  const nextCalendar = useQuery({
    ...merchantHomeCalendarQuery(nextDate, href),
    enabled: nextDate !== undefined
  })
  const calendarPending =
    calendar.isPending ||
    calendar.isPlaceholderData ||
    (selectedDate !== undefined && calendar.data?.date !== selectedDate)

  if (!calendar.data || !selectedDate) {
    return (
      <main
        data-merchant-home-layer="true"
        className="merchant-home-layer grid min-h-dvh place-items-center px-6"
        aria-hidden={overlayOpen || undefined}
        inert={overlayOpen || undefined}
      >
        <output className="text-sm text-muted-foreground">Loading appointments…</output>
      </main>
    )
  }

  return (
    <div
      data-merchant-home-layer="true"
      className="merchant-home-layer"
      aria-hidden={overlayOpen || undefined}
      inert={overlayOpen || undefined}
    >
      <MerchantShell
        section={{ kind: 'merchant' }}
        title="Appointments"
        description="Your returning-user home: a Provider-oriented day view of accepted Appointment facts."
        headerDate={selectedDate}
        headerTimezone={calendar.data?.timezone}
        bookingUrl={bookingUrl.data ?? undefined}
        layout="home"
      >
        <MobileAppointmentsScreen
          calendar={calendar.data}
          selectedDate={selectedDate}
          pending={calendarPending}
          previousCalendar={
            previousCalendar.data?.date === previousDate
              ? previousCalendar.data
              : undefined
          }
          nextCalendar={
            nextCalendar.data?.date === nextDate ? nextCalendar.data : undefined
          }
          viewerName={viewerName}
        />
      </MerchantShell>
    </div>
  )
}

function fallbackMobileSheetDescriptor(pathname: string): MobileSheetDescriptor {
  if (/^\/appointments\/[^/]+$/.test(pathname)) {
    return {
      section: { kind: 'merchant' },
      title: 'Appointment detail',
      description: 'Appointment details',
      layout: 'task'
    }
  }
  const title =
    pathname === '/walk-ins'
      ? 'Walk-in queue'
      : pathname === '/customers'
        ? 'Customers'
        : pathname === '/services'
          ? 'Services'
          : pathname === '/providers'
            ? 'Providers'
            : pathname === '/availability'
              ? 'Availability'
              : 'Settings'
  return {
    section:
      pathname === '/services' ||
      pathname === '/providers' ||
      pathname === '/availability'
        ? { kind: 'catalog', presentation: 'team' }
        : { kind: 'merchant' },
    title,
    description: '',
    layout: 'sheet'
  }
}

function MerchantMobileSheetOutlet({
  pathname,
  appointmentDate,
  overlayOpen,
  children
}: {
  readonly pathname: string
  readonly appointmentDate: string | undefined
  readonly overlayOpen: boolean
  readonly children: ReactNode
}) {
  const presentation = useMerchantPresentation()
  const router = useRouter()
  const stack = useMobileSheetStack()
  if (presentation !== 'mobile' || !stack) return <>{children}</>

  const active = stack.menuOpen || overlayOpen
  const descriptor = overlayOpen
    ? (stack.descriptor ?? fallbackMobileSheetDescriptor(pathname))
    : {
        section: { kind: 'merchant' } as const,
        title: 'Settings',
        description: 'Choose an area to manage.',
        layout: 'sheet' as const
      }
  const destinations = merchantDestinations().filter(
    (destination) => destination.to !== '/appointments'
  )
  const dismissNestedSheet = () => {
    stack.closeMenu()
    void router.navigate({
      to: '/appointments',
      search: { date: appointmentDate },
      replace: true,
      viewTransition: false
    })
  }

  return (
    <>
      {overlayOpen ? null : children}
      {active ? (
        <MobileShell
          layout={descriptor.layout}
          section={descriptor.section}
          destinations={merchantDestinations()}
          title={descriptor.title}
          description={descriptor.description}
          onRequestBack={
            overlayOpen && stack.menuOpen ? () => router.history.back() : undefined
          }
          onRequestClose={
            overlayOpen && stack.menuOpen
              ? dismissNestedSheet
              : overlayOpen
                ? undefined
                : stack.closeMenu
          }
        >
          {overlayOpen ? (
            children
          ) : (
            <MobileNavigationMenu
              destinations={destinations}
              appointmentDate={appointmentDate}
            />
          )}
        </MobileShell>
      ) : null}
    </>
  )
}

function RootDocument({
  presentation,
  children
}: {
  readonly presentation: MerchantPresentation
  readonly children: ReactNode
}) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={
        presentation === 'mobile' ? 'merchant-mobile-document antialiased' : undefined
      }
    >
      <head>
        <meta name="viewport" content={MERCHANT_PWA_VIEWPORT} />
        <HeadContent />
        <script dangerouslySetInnerHTML={{ __html: merchantThemeBootScript }} />
      </head>
      <body>
        <MerchantThemeSync />
        <MerchantPwaRegistration />
        {children}
        {import.meta.env.DEV ? <DevFpsPill /> : null}
        <Scripts />
      </body>
    </html>
  )
}
