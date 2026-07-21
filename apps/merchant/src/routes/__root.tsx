import '../onest.css'
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
import type { MerchantPresentation } from '@/lib/merchant-presentation.ts'
import { getMerchantPresentation } from '@/lib/server/merchant-presentation.ts'
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
  beforeLoad: async () => {
    const [lifecycle, presentation] = await Promise.all([
      getImpersonationLifecycle(),
      getMerchantPresentation()
    ])
    if (lifecycle?.state === 'terminated') throw redirect({ href: lifecycle.returnTo })
    return { impersonationLifecycle: lifecycle, merchantPresentation: presentation }
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
  const { impersonationLifecycle: lifecycle, merchantPresentation: presentation } =
    Route.useRouteContext()
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
