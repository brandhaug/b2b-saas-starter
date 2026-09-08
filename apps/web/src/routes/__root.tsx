import { localeLinks } from '@/lib/i18n-seo'
import * as m from '@b2b-saas-starter/i18n/messages'
import { getLocale } from '@b2b-saas-starter/i18n/runtime'
import { LocaleBootstrap } from '@/components/locale-preferences'
import { presentationSettings } from '@/lib/i18n'
import '@fontsource-variable/geist/index.css'
import '@fontsource-variable/geist-mono/index.css'
import '@fontsource-variable/newsreader/opsz.css'
// Latin variable woff2 for the text faces that render above the fold,
// resolved by Vite so the preload href always matches the emitted asset.
// Without these, the fonts start loading two round-trips deep (CSS → font
// file) after first paint. Newsreader is not preloaded here: most routes
// (sign-in, the workspace app) render no display glyphs, so its 132 kB
// preload belongs to the routes that actually use the face.
import geistLatinWoff2 from '@fontsource-variable/geist/files/geist-latin-wght-normal.woff2?url'
import geistMonoLatinWoff2 from '@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2?url'
import { type QueryClient } from '@tanstack/react-query'
import { lazy, Suspense, type ReactNode } from 'react'
import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
  Scripts
} from '@tanstack/react-router'
import { Toaster } from '@/components/ui/sonner'
import { ClientTelemetry } from '@/lib/client-telemetry'
import { clientTelemetryConfigServerFn } from '@/lib/server/telemetry-config'
import { type SidebarWorkspace } from '@/lib/workspace-directory'
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
  /**
   * Client-session memory for the last workspace visited: the workspace
   * shell writes it, surfaces without a workspace of their own (/account,
   * /admin, the picker) read it back so the sidebar keeps its shape instead
   * of collapsing to a logo. Declared here — the one owner of the router
   * context's shape — so the read/write helpers in
   * `lib/workspace-directory.ts` type it instead of asserting past it.
   * Server renders always start at `null`: never a cross-request fact.
   */
  lastWorkspace: SidebarWorkspace | null
}

export const Route = createRootRouteWithContext<RouterAppContext>()({
  // Server-side only: hands the browser SDKs their public config. Undefined
  // fields keep Sentry/PostHog inactive in the browser (see
  // lib/client-telemetry.tsx). The config crosses through a server fn whose
  // env-bag read lives behind a dynamic import — the root route is the one
  // route the code splitter cannot split, so a static import of the reader
  // would ride the entry chunk every page preloads, pinning `env/server`'s
  // Effect Schema chunk with it.
  beforeLoad: ({ location }) => ({ canonicalPath: location.pathname }),
  loader: async () => clientTelemetryConfigServerFn(),
  head: ({ match }) => ({
    meta: [
      { charSet: 'utf8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'B2B SaaS Starter' },
      {
        name: 'description',
        content: m.shell_description()
      },
      { name: 'theme-color', content: THEME_COLOR },
      { property: 'og:type', content: 'website' },
      { property: 'og:site_name', content: 'B2B SaaS Starter' },
      { name: 'twitter:card', content: 'summary' }
    ],
    links: [
      ...localeLinks(match.context.canonicalPath),
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
      /* Preload the latin variable woff2 for the text faces: the family
         names in index.css resolve to the fontsource `@font-face` rules,
         which otherwise start loading two round-trips deep (CSS → font
         file). The display face is deliberately absent — only routes that
         render display glyphs preload it. */
      {
        rel: 'preload',
        href: geistLatinWoff2,
        as: 'font',
        type: 'font/woff2',
        crossOrigin: 'anonymous'
      },
      {
        rel: 'preload',
        href: geistMonoLatinWoff2,
        as: 'font',
        type: 'font/woff2',
        crossOrigin: 'anonymous'
      }
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
  const settings = presentationSettings()
  return (
    // Catppuccin Mocha is the only scheme, painted from `:root` tokens in
    // index.css — there is no `dark` class to toggle.
    <html
      lang={getLocale()}
      data-time-zone={settings.timeZone}
      data-authenticated={String(settings.authenticated)}
      data-needs-time-zone={String(settings.needsTimeZone)}
    >
      <head>
        <HeadContent />
      </head>
      <body>
        <LocaleBootstrap />
        {children}
        {/* No `richColors`: success/warning paint from the same status tokens
              as badges and alerts (see ui/sonner.tsx), not Sonner's own hex. */}
        <Toaster />
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
