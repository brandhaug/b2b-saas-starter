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

const interpolate = (to: string, params?: Record<string, string>) =>
  params
    ? Object.entries(params).reduce(
        (path, [key, value]) => path.replace(`$${key}`, value),
        to
      )
    : to

const Link = ({
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
}) => (
  <a href={interpolate(to, params)} className={className} onClick={onClick}>
    {children}
  </a>
)

export const routerMock = (overrides: {
  /** Result of `importOriginal()`; spread first so untouched exports survive. */
  readonly actual?: Record<string, unknown>
  /** Hooks folded onto the object `createFileRoute()(options)` returns, e.g. `useSearch`, `useLoaderData`. */
  readonly routeHooks?: Record<string, unknown>
  readonly useRouter?: () => unknown
  readonly useNavigate?: () => unknown
  readonly useParams?: () => unknown
}): Record<string, unknown> => ({
  ...overrides.actual,
  createFileRoute: () => (options: Record<string, unknown>) => ({
    ...options,
    ...overrides.routeHooks
  }),
  Link,
  useRouter: overrides.useRouter ?? (() => ({})),
  useNavigate: overrides.useNavigate ?? (() => () => {}),
  useParams: overrides.useParams ?? (() => ({}))
})

/**
 * Extracts a file route's component and preloads it (route components are
 * code-split by the TanStack Start plugin; preloading once makes every render
 * in the tests synchronous).
 */
export const mountRoute = async (route: unknown): Promise<ComponentType> => {
  const component = (route as { component: ComponentType }).component
  await (component as { preload?: () => Promise<void> }).preload?.()
  return component
}
