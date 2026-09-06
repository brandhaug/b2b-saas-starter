import { useSyncExternalStore } from 'react'

/**
 * The subscribe function of a store that never changes. `useSyncExternalStore`
 * needs the shape; the unsubscribe intentionally does nothing.
 */
function subscribeToNothing(): () => void {
  // oxlint-disable-next-line no-empty-function -- the unsubscribe of a never-changing store; useSyncExternalStore requires this exact shape
  return () => {}
}

/**
 * Reads a browser-only fact through `useSyncExternalStore`: `client` runs only
 * after hydration, `server` is the render-safe value used on the server and
 * during hydration, so the value flips in the same commit that hydrates
 * instead of after a paint. `client` must be cheap — it is called on every
 * render.
 */
function useClientValue<T>(client: () => T, server: T): T {
  return useSyncExternalStore(subscribeToNothing, client, () => server)
}

export { useClientValue }
