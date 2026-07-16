import '@fontsource-variable/geist/index.css'
import '@fontsource-variable/geist-mono/index.css'
import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { NotFoundPage } from '../components/not-found-page'
import { BookingLocalizationProvider } from '../localization/booking-localization-provider'
import { BOOKING_PWA_THEME_COLOR, BOOKING_PWA_VIEWPORT } from '../lib/merchant-pwa'
import appCss from '../index.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      {
        name: 'viewport',
        content: BOOKING_PWA_VIEWPORT
      },
      { name: 'theme-color', content: BOOKING_PWA_THEME_COLOR },
      { title: 'Book an appointment' },
      {
        name: 'description',
        content: 'Choose a professional and services for your appointment.'
      }
    ],
    links: [{ rel: 'stylesheet', href: appCss }]
  }),
  component: RootComponent,
  notFoundComponent: NotFoundPage
})

function RootComponent() {
  const [queryClient] = useState(() => new QueryClient())
  return (
    <html lang="en">
      <head>
        <HeadContent />
        {import.meta.env.DEV ? (
          <>
            <link rel="stylesheet" href="/_booking/virtual:stylex.css" />
            <StylexDevRuntime />
          </>
        ) : null}
      </head>
      <body>
        <QueryClientProvider client={queryClient}>
          <BookingLocalizationProvider>
            <Outlet />
          </BookingLocalizationProvider>
        </QueryClientProvider>
        <Scripts />
      </body>
    </html>
  )
}

function StylexDevRuntime() {
  useEffect(() => {
    const script = document.createElement('script')
    script.type = 'module'
    script.src = '/_booking/@id/virtual:stylex:runtime'
    document.head.appendChild(script)
    return () => {
      script.remove()
    }
  }, [])

  return null
}
