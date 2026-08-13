import type { ComponentType, ReactNode } from 'react'

/**
 * Shared `@tanstack/react-router` mock for component/route tests. Because
 * `vi.mock` factories are hoisted, import this module *inside* the factory:
 *
 * ```ts
 * vi.mock('@tanstack/react-router', async (importOriginal) => {
 *   const { routerMock } = await import('@/test/router-mock')
 *   return routerMock({
 *     actual: await importOriginal<Record<string, unknown>>(),
 *     routeHooks: { useSearch: () => mocks.search.value },
 *     useNavigate: () => mocks.navigate
 *   })
 * })
 * ```
 */

function interpolate(to: string, params?: Record<string, string>): string {
  return params
    ? Object.entries(params).reduce(
        (path, [key, value]) => path.replace(`$${key}`, value),
        to
      )
    : to
}

function Link({
  to,
  params,
  children,
  className,
  onClick
}: {
  readonly to: string
  readonly params?: Record<string, string>
  readonly children?: ReactNode
  readonly className?: string
  readonly onClick?: () => void
}) {
  return (
    <a href={interpolate(to, params)} className={className} onClick={onClick}>
      {children}
    </a>
  )
}

export function routerMock(overrides: {
  /** Result of `importOriginal()`; spread first so untouched exports survive. */
  readonly actual?: Record<string, unknown>
  /** Hooks folded onto the object `createFileRoute()(options)` returns, e.g. `useSearch`, `useLoaderData`. */
  readonly routeHooks?: Record<string, unknown>
  readonly useRouter?: () => unknown
  readonly useNavigate?: () => unknown
  readonly useParams?: () => unknown
}): Record<string, unknown> {
  return {
    ...overrides.actual,
    createFileRoute: () => (options: Record<string, unknown>) => ({
      ...options,
      ...overrides.routeHooks
    }),
    Link,
    useRouter: overrides.useRouter ?? (() => ({})),
    useNavigate: overrides.useNavigate ?? (() => () => {}),
    useParams: overrides.useParams ?? (() => ({}))
  }
}

/**
 * A route component as the TanStack Start plugin leaves it: code-split, with a
 * `preload` hook attached.
 */
type PreloadableComponent = ComponentType & {
  readonly preload?: () => Promise<void>
}

/**
 * Callers pass the `Route` export of a route module, whose *static* type is
 * TanStack's `Route` (no public `component`). Under `routerMock` the runtime
 * value is the plain options object instead, so the component is recovered by
 * an actual check rather than an assertion.
 */
function hasRouteComponent(
  route: unknown
): route is { readonly component: PreloadableComponent } {
  return typeof route === 'object' && route !== null && 'component' in route
}

/**
 * Extracts a file route's component and preloads it (route components are
 * code-split by the TanStack Start plugin; preloading once makes every render
 * in the tests synchronous).
 */
export async function mountRoute(route: unknown): Promise<ComponentType> {
  if (!hasRouteComponent(route)) {
    throw new Error(
      'mountRoute: route has no component — is @tanstack/react-router mocked with routerMock?'
    )
  }
  await route.component.preload?.()
  return route.component
}
