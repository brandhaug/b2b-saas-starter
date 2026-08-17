import '@fontsource-variable/geist/index.css'
import '@fontsource-variable/geist-mono/index.css'
import '@fontsource-variable/archivo/standard.css'
import { type QueryClient } from '@tanstack/react-query'
import { lazy, Suspense, type ReactNode } from 'react'
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
const THEME_COLOR_DARK = '#1d1d1d'
const THEME_COLOR_LIGHT = '#ffffff'

// Named lazy loader: the devtools bundle must stay out of the production
// graph, so the import is deferred behind this one binding.
async function loadRouterDevtools() {
  const devtools = await import('@tanstack/react-router-devtools')
  return { default: devtools.TanStackRouterDevtools }
}

const TanStackRouterDevtools = import.meta.env.DEV
  ? lazy(loadRouterDevtools)
  : () => null

type RouterAppContext = {
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<RouterAppContext>()({
  head: () => ({
    meta: [
      { charSet: 'utf8' },
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
