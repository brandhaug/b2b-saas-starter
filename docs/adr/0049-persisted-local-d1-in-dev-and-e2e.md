# Persisted local D1 in development and end-to-end tests

The dev-only Cloudflare shim uses Wrangler's platform proxy to attach migrated local D1. Without that state, the app uses Seed capabilities; real credential sign-in requires D1. Unit tests and standalone builds use an inert shim. Alchemy deployment uses native Worker bindings on the server and the inert shim only in the browser; Wrangler stays out of both bundles.

This keeps the ordinary Vite development loop while exercising Better Auth against real tables. The demo identity must agree across Seed and D1 because client navigation and server loads can use different adapters.
