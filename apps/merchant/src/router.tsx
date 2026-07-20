import { createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'
import './index.css'

if (import.meta.env.DEV && typeof window !== 'undefined') {
  void import('react-grab')
}

export function getRouter() {
  return createRouter({
    routeTree,
    defaultPreload: 'intent',
    scrollRestoration: true
  })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
