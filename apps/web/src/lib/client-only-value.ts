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
 * True only after hydration, without a mount effect: the server (and
 * hydration) snapshot is `false` and the client snapshot is `true`, so the
 * value flips in the same commit that hydrates instead of after a paint.
 */
function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false
  )
}

/**
 * Reads a browser-only fact through `useSyncExternalStore`: `client` runs only
 * after hydration, `server` is the render-safe value used on the server and
 * during hydration. `client` must be referentially stable and cheap — it is
 * called on every render.
 */
function useClientValue<T>(client: () => T, server: T): T {
  return useSyncExternalStore(subscribeToNothing, client, () => server)
}

export { useClientValue, useHydrated }
