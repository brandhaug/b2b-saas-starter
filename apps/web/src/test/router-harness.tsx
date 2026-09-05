import { type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  type AnyRouter
} from '@tanstack/react-router'
import { render, type RenderResult } from '@testing-library/react'

/**
 * Renders a component under a real TanStack router.
 *
 * The router is the library's own test seam — `createMemoryHistory` plus
 * `RouterProvider` — so `Link`, `useRouter`, and `useNavigate` are the shipped
 * implementations rather than stand-ins. That means an `href` assertion checks
 * the real path builder, and a navigation assertion reads
 * `router.state.location.pathname` after the fact instead of asking whether a
 * `navigate` double was called: the test states where the user ended up, which
 * is the thing that has to keep being true.
 *
 * A `QueryClient` comes with it, because production wires one into the router
 * context and `useServerAction` (so every panel mutation) reads it. Retries are
 * off so a failing call surfaces in the first assertion rather than after a
 * backoff.
 *
 * `destinations` are the paths the component under test can navigate to. They
 * have to be registered, because navigating to an unregistered path resolves to
 * the router's not-found handling and the pathname assertion would then be
 * checking nothing. Each gets a placeholder component; only the location matters.
 *
 * `routeContext` is what the route under test's `beforeLoad` returns — the
 * stand-in for a gate's `{ session }`, for components that read the route
 * context (`useRouteContext`) instead of taking it as a prop.
 *
 * `routerContext` seeds the router-level context object instead — the
 * client-session memory production keeps there (`lastWorkspace`, see
 * `lib/workspace-directory.ts`), for tests of the surfaces that read it back.
 */
export async function renderWithRouter(
  ui: ReactNode,
  options?: {
    readonly path?: string
    readonly destinations?: ReadonlyArray<string>
    readonly initialEntry?: string
    readonly routeContext?: Record<string, unknown>
    readonly routerContext?: Record<string, unknown>
  }
): Promise<RenderResult & { readonly router: AnyRouter }> {
  const path = options?.path ?? '/'
  const rootRoute = createRootRoute()
  const routeContext = options?.routeContext ?? {}
  const routeUnderTest = createRoute({
    getParentRoute: () => rootRoute,
    path,
    beforeLoad: () => routeContext,
    component: () => ui
  })
  const destinations = [...new Set(options?.destinations ?? [])]
    .filter((destination) => destination !== path)
    .map((destination) =>
      createRoute({
        getParentRoute: () => rootRoute,
        path: destination,
        component: () => <p>{destination}</p>
      })
    )
  const router = createRouter({
    routeTree: rootRoute.addChildren([routeUnderTest, ...destinations]),
    history: createMemoryHistory({ initialEntries: [options?.initialEntry ?? path] }),
    context: options?.routerContext ?? {}
  })
  // The router resolves its first match asynchronously, so priming it here keeps
  // the render synchronous for callers and their queries.
  await router.load()
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  })
  return {
    ...render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    ),
    router
  }
}
