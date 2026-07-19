import '@fontsource-variable/geist/index.css'
import '@fontsource-variable/geist-mono/index.css'
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
import appCss from '../index.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Merchant App' },
      {
        name: 'description',
        content: 'The authenticated Merchant App for the Booking Product.'
      }
    ],
    links: [{ rel: 'stylesheet', href: appCss }]
  }),
  beforeLoad: async () => {
    const lifecycle = await getImpersonationLifecycle()
    if (lifecycle?.state === 'terminated') throw redirect({ href: lifecycle.returnTo })
    return { impersonationLifecycle: lifecycle }
  },
  component: RootComponent
})

function RootComponent() {
  const { impersonationLifecycle: lifecycle } = Route.useRouteContext()
  const router = useRouter()
  return (
    <RootDocument>
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
      <Outlet />
    </RootDocument>
  )
}

function RootDocument({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}
