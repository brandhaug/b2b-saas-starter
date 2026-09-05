import { QueryClient } from '@tanstack/react-query'
import { createRouter, Link } from '@tanstack/react-router'
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query'
import { routeTree } from './routeTree.gen'
import { CAPABILITY_UNAVAILABLE_ERROR_NAME } from '@/lib/capability-error'
import { type SidebarWorkspace } from '@/lib/workspace-directory'

function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-sm text-muted-foreground">
        The page you are looking for does not exist.
      </p>
      <Link to="/" className="text-sm underline underline-offset-4">
        Go home
      </Link>
    </div>
  )
}

// Degraded-state errors carry a friendly, self-explanatory message. Loader
// errors cross the SSR boundary via TanStack's `defaultSerializeError`, which
// keeps only `name`/`message` — so `name` is the discriminant (never
// `instanceof`), single-sourced from `capability-error.ts`.
function RouteError({ error }: { readonly error: Error }) {
  const degraded = error.name === CAPABILITY_UNAVAILABLE_ERROR_NAME
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold">
        {degraded ? 'Temporarily unavailable' : 'Something went wrong'}
      </h1>
      <p className="max-w-md text-center text-sm text-muted-foreground">
        {degraded
          ? error.message
          : 'An unexpected error occurred. Try again, and check the server logs if it persists.'}
      </p>
      <Link to="/" className="text-sm underline underline-offset-4">
        Go home
      </Link>
    </div>
  )
}

export function getRouter() {
  const queryClient = new QueryClient()
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
    defaultPreload: 'intent',
    defaultNotFoundComponent: NotFound,
    defaultErrorComponent: RouteError,
    context
  })

  setupRouterSsrQueryIntegration({ router, queryClient })
  return router
}

// The `Register` augmentation lives in `router-register.d.ts` — see the note there.
