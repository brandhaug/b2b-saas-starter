# apps/operations

Staff-only Operations App. It is a separate Cloudflare Worker and auth realm.
Only allowlisted Operations authentication endpoints may be exposed. Operator
authority must resolve from current D1 state through the Operations auth and
Effect contract seams; never derive it from Merchant membership or UI state.
