# apps/operations

Staff-only Operations App. It is a TanStack Start application deployed as a
separate Cloudflare Worker and auth realm. Browser pages belong in typed React
routes; explicit auth, readiness, local-capture, and server-function HTTP
contracts remain at the Worker boundary.
Only allowlisted Operations authentication endpoints may be exposed. Operator
authority must resolve from current D1 state through the Operations auth and
Effect contract seams; never derive it from Merchant membership or UI state.
