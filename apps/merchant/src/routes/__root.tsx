import type { ComponentProps } from 'react'
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import {
  createRootRouteWithContext,
  Outlet,
  redirect,
  useLocation,
  useRouter
} from '@tanstack/react-router'
import { ImpersonationBanner } from '@/components/impersonation-banner.tsx'
import { MerchantHomeLayer } from '@/components/merchant-home-layer.tsx'
import { MerchantMobileSheetOutlet } from '@/components/merchant-mobile-sheet-outlet.tsx'
import { MerchantRootDocument } from '@/components/merchant-root-document.tsx'
import { MerchantPresentationProvider } from '@/components/merchant-shell/merchant-presentation.tsx'
import { MobileSheetStackProvider } from '@/components/merchant-shell/mobile/mobile-sheet-stack.tsx'
import { merchantHomeDate } from '@/lib/merchant-home-date.ts'
import {
  isMerchantOverlayPath,
  shouldRenderMerchantHome
} from '@/lib/merchant-home-route.ts'
import { merchantPwaHeadLinks, merchantPwaHeadMeta } from '@/lib/merchant-pwa.ts'
import { safeOperationsReturnUrl } from '@/lib/safe-operations-return-url.ts'
import {
  getImpersonationLifecycle,
  stopImpersonation
} from '@/lib/server/impersonation-lifecycle.ts'
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
    if (lifecycle?.state === 'terminated') {
      const safeReturnTo = safeOperationsReturnUrl(lifecycle.returnTo)
      if (safeReturnTo) throw redirect({ href: safeReturnTo })
      throw redirect({
        to: '/sign-in',
        search: { redirect: undefined }
      })
    }
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
    <MerchantRootDocument presentation={presentation}>
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
                if (stopped?.state === 'terminated') {
                  const safeReturnTo = safeOperationsReturnUrl(stopped.returnTo)
                  window.location.assign(safeReturnTo ?? '/sign-in')
                }
              }}
            />
          </div>
        ) : null}
        <MerchantPresentationProvider presentation={presentation}>
          <MobileSheetStackProvider>
            <div data-merchant-mobile-sheet-portal="true" />
            {shouldRenderMerchantHome(location.pathname) ? (
              <MerchantHomeLayer
                href={location.href}
                search={location.search}
                state={location.state}
                overlayOpen={merchantOverlayOpen}
                viewer={viewer ?? undefined}
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
    </MerchantRootDocument>
  )
}
