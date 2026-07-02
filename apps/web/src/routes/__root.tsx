import '@fontsource-variable/geist/index.css'
import '@fontsource-variable/geist-mono/index.css'
import '@fontsource-variable/archivo/standard.css'
import type { QueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { lazy, Suspense } from 'react'
import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
  Scripts
} from '@tanstack/react-router'
import { ThemeProvider } from 'next-themes'
import { CommandPaletteProvider } from '@/components/command-palette'
import { Toaster } from '@/components/ui/sonner'
import appCss from '../index.css?url'

// Browser `theme-color` meta requires literal color values — cannot use CSS vars.
const THEME_COLOR_DARK = '#1d1d1d' as const
const THEME_COLOR_LIGHT = '#ffffff' as const

const TanStackRouterDevtools = import.meta.env.DEV
  ? lazy(() =>
      import('@tanstack/react-router-devtools').then((mod) => ({
        default: mod.TanStackRouterDevtools
      }))
    )
  : () => null

interface RouterAppContext {
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<RouterAppContext>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'B2B SaaS Starter' },
      {
        name: 'description',
        content:
          'Cloudflare-first B2B SaaS starter with TanStack Start, Effect v4, Drizzle D1, Better Auth, REST, MCP, email, and tests.'
      },
      {
        name: 'theme-color',
        content: THEME_COLOR_DARK,
        media: '(prefers-color-scheme: dark)'
      },
      {
        name: 'theme-color',
        content: THEME_COLOR_LIGHT,
        media: '(prefers-color-scheme: light)'
      },
      { property: 'og:type', content: 'website' },
      { property: 'og:site_name', content: 'B2B SaaS Starter' },
      { property: 'og:image', content: '/og-default.png' },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:image', content: '/og-default.png' }
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }
    ]
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
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
          <CommandPaletteProvider>
            {children}
            <Toaster richColors />
          </CommandPaletteProvider>
        </ThemeProvider>
        {import.meta.env.DEV && (
          <Suspense>
            <TanStackRouterDevtools position="bottom-right" />
          </Suspense>
        )}
        <Scripts />
      </body>
    </html>
  )
}
