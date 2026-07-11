# apps/booking

Private customer-facing Booking Worker reached through the Public Site binding. Route
loaders, server functions, and components compose transport-neutral capabilities; they
do not calculate eligibility, pricing, holds, settlement, or lifecycle transitions.

The existing Pay In Person appointment path is the **Booking Vertical Slice**: preserve
it while evolving the app in place. The accepted **full-parity target** is the larger
contract ledgered in `src/parity/full-parity-manifest.ts`; planned ledger entries are
delivery obligations, not claims that the current runtime already implements them.

Keep the Booking theme, typed presentation primitives, localization catalogs, browser
provider adapters, route/query composition, and transient UI state in this app. Run
`bun scripts/check-full-parity-ledger.ts` after changing parity inventory, scenarios,
ownership, or status.
