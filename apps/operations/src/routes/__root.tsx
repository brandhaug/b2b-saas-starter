import '@fontsource-variable/geist/index.css'
import '@fontsource-variable/geist-mono/index.css'
import type { ReactNode } from 'react'
import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router'
import appCss from '../index.css?url'
import { ThemeProvider } from '@/components/theme-provider'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Operations App' },
      {
        name: 'description',
        content: 'Staff-only support and administration for the Booking Product.'
      }
    ],
    links: [{ rel: 'stylesheet', href: appCss }]
  }),
  component: RootComponent
})

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  )
}

function RootDocument({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
        <Scripts />
      </body>
    </html>
  )
}
