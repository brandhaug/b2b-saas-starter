# apps/operations

Staff-only Operations App. It is a TanStack Start application deployed as a
separate Cloudflare Worker and auth realm. Browser pages belong in typed React
routes; explicit auth, readiness, local-capture, and server-function HTTP
contracts remain at the Worker boundary.

## Source layout

- `src/routes/` owns TanStack route modules and route-level browser tests.
- `src/components/` owns Operations-specific presentation components.
- `src/lib/server/` owns the authoritative Worker, server functions,
  configuration, enrollment, management, email, and their colocated tests.
- `src/lib/` owns small transport-neutral helpers and local Worker shims.
- `src/server.ts`, `src/router.tsx`, and generated `src/routeTree.gen.ts`
  are entry points, not homes for application behavior.

Keep route handlers thin and import server behavior through
`src/lib/server/operations-server-functions.ts`. The shadcn/Base UI registry in
`src/components/ui/` is the Operations presentation foundation; keep generated
primitives isolated there and build domain-specific composition in
`src/components/`, not directly in route modules.

Only allowlisted Operations authentication endpoints may be exposed. Operator
authority must resolve from current D1 state through the Operations auth and
Effect contract seams; never derive it from Merchant membership or UI state.
