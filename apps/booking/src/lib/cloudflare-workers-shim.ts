// Build/test fallback for the Worker binding. Deployed Workers pass their
// bindings as the second `fetch` argument; the dev-only shim provides local
// bindings when TanStack's Vite adapter omits that argument.
export const env = {}
