# apps/web

Unauthenticated Public Site and canonical Booking ingress. It owns editorial pages,
public Merchant pages, and dispatches the `/booking/:merchantSlug` landing plus
merchant-scoped `/:merchantSlug/booking/**` session traffic to the Booking App.
It does not own authentication or Merchant product operations; those belong only to
`apps/merchant`.

Public Merchant reads require the D1 binding and fail with the typed degraded state
when unavailable. Never fall back to Seed data in this runtime. Static editorial
content may describe the repository but must not depend on retired Workspace state.

Use TanStack file routes, shadcn primitives, semantic Tailwind tokens, and real D1
capabilities for runtime reads. Vitest covers units and Playwright covers public route
ownership.
