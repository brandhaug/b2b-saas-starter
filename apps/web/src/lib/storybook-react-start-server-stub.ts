// Storybook-only stub for `@tanstack/react-start/server`.
//
// Storybook's vite build has no TanStack Start plugin (see vite.config.ts's
// isStorybook branch), and `src/lib/request-context.ts` statically imports
// `getRequest` from the server entry — which drags the whole server-core
// graph (virtual manifest modules, package-internal entry specifiers) into a
// build that must resolve every import. Server-fn modules a story imports
// reach it through `request-context`, so stubbing the server entry here keeps
// the entire subtree out of Storybook's bundle.
//
// The stub matches `currentRequest`'s own no-request semantics: outside a
// Start request there is no ambient request, and `request-context.ts`'s
// `ambientRequest` catch turns that into `undefined` — which is the state
// every Storybook render is in anyway.
export function getRequest(): Request {
  throw new Error('No TanStack Start request context in Storybook.')
}
