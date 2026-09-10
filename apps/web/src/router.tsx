import { isStrongAuthenticationError } from '@/lib/ui-error'
import { FallbackPage } from '@/components/fallback-page'
import { SupportDetails } from '@/components/support-details'
import * as m from '@b2b-saas-starter/i18n/messages'
import { deLocalizeUrl, localizeUrl } from '@b2b-saas-starter/i18n/runtime'
import { QueryClient } from '@tanstack/react-query'
import { createRouter, Link } from '@tanstack/react-router'
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query'
import { routeTree } from './routeTree.gen'
import { CAPABILITY_UNAVAILABLE_ERROR_NAME } from '@/lib/capability-error'
import { type SidebarWorkspace } from '@/lib/workspace-directory'
import { StrongAuthenticationNotice } from '@/components/strong-authentication-notice'

function NotFound() {
  return (
    <FallbackPage>
      <h1 className="text-3xl font-semibold tracking-tight">{m.shell_not_found()}</h1>
      <p className="text-sm text-muted-foreground">{m.shell_not_found_description()}</p>
      <Link
        to="/"
        className="inline-flex items-center text-sm underline underline-offset-4 max-md:min-h-11"
      >
        {m.shell_home()}
      </Link>
      <Link
        to="/help"
        reloadDocument
        className="inline-flex items-center text-sm underline underline-offset-4 max-md:min-h-11"
      >
        {m.public_meta_support()}
      </Link>
    </FallbackPage>
  )
}

// Degraded-state errors carry a friendly, self-explanatory message. Loader
// errors cross the SSR boundary via TanStack's `defaultSerializeError`, which
// keeps only `name`/`message` — so `name` is the discriminant (never
// `instanceof`), single-sourced from `capability-error.ts`.
function RouteError({ error }: { readonly error: Error }) {
  if (isStrongAuthenticationError(error)) {
    return <StrongAuthenticationNotice />
  }
  const degraded = error.name === CAPABILITY_UNAVAILABLE_ERROR_NAME
  return (
    <FallbackPage>
      <h1 className="text-3xl font-semibold tracking-tight">
        {degraded ? m.shell_unavailable() : m.shell_error()}
      </h1>
      <p className="max-w-md text-sm text-muted-foreground">
        {degraded ? m.shell_unavailable_description() : m.shell_error_description()}
      </p>
      <Link
        to="/"
        className="inline-flex items-center text-sm underline underline-offset-4 max-md:min-h-11"
      >
        {m.shell_home()}
      </Link>
      <SupportDetails routeName="application" />
      <Link
        to="/help"
        reloadDocument
        className="inline-flex items-center text-sm underline underline-offset-4 max-md:min-h-11"
      >
        {m.public_meta_support()}
      </Link>
    </FallbackPage>
  )
}

export function getRouter() {
  // Query defaults, not library defaults: the SSR payload a page hydrates
  // from is trusted for 30s instead of being refetched the moment a component
  // mounts, and returning to the tab does not restart every query a
  // multi-panel page holds at once.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } }
  })
  // `lastWorkspace` remembers the workspace the user last visited: the
  // workspace shell writes it, and surfaces without a workspace of their own
  // (/account, /admin, the picker) read it back so the sidebar keeps its shape
  // instead of collapsing to a logo. Server renders always start at `null` —
  // it is client-session memory, never a cross-request fact. The root route's
  // context type is closed (`RouterAppContext` declares only `queryClient`), so
  // this rides the runtime context object, reached only through the helpers in
  // lib/workspace-directory.ts — hence a const, not a literal, at this call.
  const context = {
    queryClient,
    lastWorkspace: null satisfies SidebarWorkspace | null
  }
  const router = createRouter({
    routeTree,
    rewrite: {
      input: ({ url }) => deLocalizeUrl(url),
      output: ({ url }) => localizeUrl(url)
    },
    defaultPreload: 'intent',
    defaultNotFoundComponent: NotFound,
    defaultErrorComponent: RouteError,
    context
  })

  setupRouterSsrQueryIntegration({ router, queryClient })
  return router
}

// The `Register` augmentation lives in `router-register.d.ts` — see the note there.
