import { QueryClient } from '@tanstack/react-query'
import { createRouter, Link } from '@tanstack/react-router'
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query'
import { routeTree } from './routeTree.gen'
import { CAPABILITY_UNAVAILABLE_ERROR_NAME } from '@/lib/capability-error'
import './index.css'

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
  const router = createRouter({
    routeTree,
    defaultPreload: 'intent',
    defaultNotFoundComponent: NotFound,
    defaultErrorComponent: RouteError,
    context: { queryClient }
  })

  setupRouterSsrQueryIntegration({ router, queryClient })
  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
