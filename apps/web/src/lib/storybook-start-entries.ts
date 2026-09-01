// Storybook-only stubs for the TanStack Start entry specifiers.
//
// Storybook's vite builder merges this app's vite.config.ts into its own
// program, but without the `tanstackStart()` plugin (see the config's
// isStorybook branch) nothing aliases the package-internal entry specifiers
// that the server-core graph references (`@tanstack/react-start/server` is
// reachable from server-fn modules a story imports). The Start plugin aliases
// them to real virtual entries in app builds; here they only need to resolve
// so bundling succeeds — the start handler that consumes them never runs
// inside Storybook. Shape mirrors the fake entries the TanStack packages ship
// for plugin-less builds (`start-client-core/dist/esm/fake-entries`).
export const startInstance = {}
export const routerEntry = {}
