import type { ComponentProps, ReactNode } from 'react'
import {
  createRootRoute,
  HeadContent,
  Outlet,
  redirect,
  Scripts,
  useRouter
} from '@tanstack/react-router'
import { ImpersonationBanner } from '@/components/impersonation-banner.tsx'
import {
  getImpersonationLifecycle,
  stopImpersonation
} from '@/lib/server/impersonation-lifecycle.ts'
import { MerchantPresentationProvider } from '@/components/merchant-shell/merchant-presentation.tsx'
import { MobileAppointmentsScreen } from '@/features/appointments/mobile/mobile-appointments-screen.tsx'
import { decodeAppointmentCalendarSearch } from '@/lib/appointment-calendar-date.ts'
import { shouldReconstructMobileHomeUnderlay } from '@/lib/mobile-sheet-underlay.ts'
import type { MerchantPresentation } from '@/lib/merchant-presentation.ts'
import { merchantThemeBootScript } from '@/lib/merchant-theme.ts'
import { getMerchantPresentation } from '@/lib/server/merchant-presentation.ts'
import { getMobileSheetUnderlayCalendar } from '@/lib/server/mobile-sheet-underlay.ts'
import onestLatinFont from '@fontsource-variable/onest/files/onest-latin-wght-normal.woff2?url'
import appCss from '../index.css?url'

export const merchantHeadLinks = [
  { rel: 'stylesheet', href: appCss },
  {
    rel: 'preload',
    href: onestLatinFont,
    as: 'font',
    type: 'font/woff2',
    crossOrigin: 'anonymous'
  }
] satisfies ComponentProps<'link'>[]

export const Route = createRootRoute({
  beforeLoad: async ({ location }) => {
    const [lifecycle, presentation] = await Promise.all([
      getImpersonationLifecycle(),
      getMerchantPresentation()
    ])
    if (lifecycle?.state === 'terminated') throw redirect({ href: lifecycle.returnTo })
    const reconstructMobileHome = shouldReconstructMobileHomeUnderlay({
      pathname: location.pathname,
      presentation,
      navigationState: location.state,
      documentRequest: typeof document === 'undefined'
    })
    let requestedDate: string | undefined
    try {
      requestedDate = decodeAppointmentCalendarSearch(location.search).date
    } catch {
      requestedDate = undefined
    }
    const mobileHomeCalendar = reconstructMobileHome
      ? await getMobileSheetUnderlayCalendar({
          data: { date: requestedDate, redirectTo: location.href }
        })
      : null
    return {
      impersonationLifecycle: lifecycle,
      merchantPresentation: presentation,
      mobileHomeCalendar
    }
  },
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { title: 'Merchant App' },
      {
        name: 'description',
        content: 'The authenticated Merchant App for the Booking Product.'
      }
    ],
    links: merchantHeadLinks
  }),
  component: RootComponent
})

function RootComponent() {
  const {
    impersonationLifecycle: lifecycle,
    merchantPresentation: presentation,
    mobileHomeCalendar
  } = Route.useRouteContext()
  const router = useRouter()
  return (
    <RootDocument presentation={presentation}>
      {lifecycle?.state === 'active' ? (
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
      ) : null}
      <MerchantPresentationProvider
        presentation={presentation}
        mobileHomeUnderlay={
          mobileHomeCalendar ? (
            <MobileAppointmentsScreen
              calendar={mobileHomeCalendar}
              selectedDate={mobileHomeCalendar.date}
            />
          ) : undefined
        }
        mobileHomeDate={mobileHomeCalendar?.date}
      >
        <Outlet />
      </MerchantPresentationProvider>
    </RootDocument>
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
      className={presentation === 'mobile' ? 'merchant-mobile-document' : undefined}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: merchantThemeBootScript }} />
        <meta
          name="viewport"
          content={
            presentation === 'mobile'
              ? 'width=375, minimum-scale=1, shrink-to-fit=no'
              : 'width=device-width, initial-scale=1'
          }
        />
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}
