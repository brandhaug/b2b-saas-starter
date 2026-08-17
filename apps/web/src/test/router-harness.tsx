import { type ReactNode } from 'react'
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
 * `destinations` are the paths the component under test can navigate to. They
 * have to be registered, because navigating to an unregistered path resolves to
 * the router's not-found handling and the pathname assertion would then be
 * checking nothing. Each gets a placeholder component; only the location matters.
 */
export async function renderWithRouter(
  ui: ReactNode,
  options?: {
    readonly path?: string
    readonly destinations?: readonly string[]
    readonly initialEntry?: string
  }
): Promise<RenderResult & { readonly router: AnyRouter }> {
  const path = options?.path ?? '/'
  const rootRoute = createRootRoute()
  const routeUnderTest = createRoute({
    getParentRoute: () => rootRoute,
    path,
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
    history: createMemoryHistory({ initialEntries: [options?.initialEntry ?? path] })
  })
  // The router resolves its first match asynchronously, so priming it here keeps
  // the render synchronous for callers and their queries.
  await router.load()
  return { ...render(<RouterProvider router={router} />), router }
}
