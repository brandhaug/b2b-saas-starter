import '@fontsource-variable/onest/index.css'
import type { ReactNode } from 'react'
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
import { DesktopWorkspaceMemoryProvider } from '@/components/merchant-shell/desktop-workspace-memory.tsx'
import { DesktopAppointmentsScreen } from '@/features/appointments/desktop/desktop-appointments-screen.tsx'
import type { MerchantPresentation } from '@/lib/merchant-presentation.ts'
import { loadDesktopWorkspaceCalendar } from '@/lib/server/desktop-workspace.ts'
import { getMerchantPresentation } from '@/lib/server/merchant-presentation.ts'
import appCss from '../index.css?url'

export const Route = createRootRoute({
  beforeLoad: async ({ location }) => {
    const [lifecycle, presentation, desktopAppointmentCalendar] = await Promise.all([
      getImpersonationLifecycle(),
      getMerchantPresentation(),
      loadDesktopWorkspaceCalendar(location)
    ])
    if (lifecycle?.state === 'terminated') throw redirect({ href: lifecycle.returnTo })
    return {
      impersonationLifecycle: lifecycle,
      merchantPresentation: presentation,
      desktopAppointmentCalendar
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
    links: [{ rel: 'stylesheet', href: appCss }]
  }),
  component: RootComponent
})

function RootComponent() {
  const {
    impersonationLifecycle: lifecycle,
    merchantPresentation: presentation,
    desktopAppointmentCalendar
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
      <MerchantPresentationProvider presentation={presentation}>
        <DesktopWorkspaceMemoryProvider
          key={desktopAppointmentCalendar ? 'merchant' : 'public'}
          fallback={
            desktopAppointmentCalendar ? (
              <DesktopAppointmentsScreen
                calendar={desktopAppointmentCalendar}
                selectedDate={desktopAppointmentCalendar.date}
              />
            ) : null
          }
        >
          <Outlet />
        </DesktopWorkspaceMemoryProvider>
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
      className={presentation === 'mobile' ? 'merchant-mobile-document' : undefined}
    >
      <head>
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
