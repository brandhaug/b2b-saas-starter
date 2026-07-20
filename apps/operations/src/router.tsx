import { createRouter, type RouterHistory } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'
import './index.css'

export function getRouter(history?: RouterHistory) {
  return createRouter({
    routeTree,
    ...(history ? { history } : {}),
    defaultPreload: 'intent',
    scrollRestoration: true,
    defaultPendingComponent: () => (
      <main aria-busy="true" className="operations-page">
        <p className="text-sm text-muted-foreground">
          Loading current Operations state…
        </p>
      </main>
    ),
    defaultErrorComponent: () => (
      <main className="operations-page" role="alert">
        <h1 className="text-2xl font-semibold">Operations unavailable</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The current screen could not be loaded. Try again shortly.
        </p>
      </main>
    )
  })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
