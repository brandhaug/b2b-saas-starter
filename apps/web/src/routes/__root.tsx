import '@fontsource-variable/geist/index.css'
import '@fontsource-variable/geist-mono/index.css'
import '@fontsource-variable/fraunces/opsz.css'
import { type QueryClient } from '@tanstack/react-query'
import { lazy, Suspense, type ReactNode } from 'react'
import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
  Scripts
} from '@tanstack/react-router'
import { CommandPaletteProvider } from '@/components/command-palette'
import { Toaster } from '@/components/ui/sonner'
import { ClientTelemetry } from '@/lib/client-telemetry'
import { readClientTelemetryConfig } from '@/lib/server/telemetry-config'
import appCss from '../index.css?url'

// Browser `theme-color` meta requires literal color values — cannot use CSS vars.
// One value: the app is Catppuccin Mocha in every context, so there is no
// `prefers-color-scheme`-keyed pair to declare.
const THEME_COLOR = '#1e1e2e' /* mocha base */

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
  // Server-side only: hands the browser SDKs their public config. Undefined
  // fields keep Sentry/PostHog inactive in the browser (see
  // lib/client-telemetry.tsx). The loader runs on the server for SSR and
  // client navigations alike, so `cloudflare:workers` env is always readable.
  loader: () => readClientTelemetryConfig(),
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
      { name: 'theme-color', content: THEME_COLOR },
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
  const telemetryConfig = Route.useLoaderData()
  return (
    <RootDocument>
      <ClientTelemetry config={telemetryConfig} />
      <Outlet />
    </RootDocument>
  )
}

function RootDocument({ children }: { readonly children: ReactNode }) {
  return (
    // `dark` is hardcoded rather than toggled: Catppuccin Mocha is the only
    // scheme, and the class is what shadcn's `dark:` variants key off.
    <html lang="en" className="dark">
      <head>
        <HeadContent />
      </head>
      <body>
        <CommandPaletteProvider>
          {children}
          <Toaster richColors />
        </CommandPaletteProvider>
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
