import { createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'
import './index.css'

export function getRouter() {
  return createRouter({
    routeTree,
    basepath: '/',
    defaultPreload: 'intent',
    scrollRestoration: true
  })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
