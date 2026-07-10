# Minimum Merchant Surface Prototype

**Question:** What is the smallest Merchant App surface that can create, edit, or inspect the data needed for the first customer booking journey?

Three variants live at `/prototype/minimum-merchant-surface?variant=A`, switchable with the floating bar or the left/right arrow keys.

- **A — Guided launch:** group configuration by the work required to become bookable.
- **B — Source-reduced operations rail:** preserve the legacy app's Appointments-first operator shell, provider day calendar, Service Details → Providers flow, and Provider Profile/Services/Schedule tabs while cutting deferred modules.
- **C — Booking chain:** mirror the customer journey and edit each input where it affects the chain.

All changes are in-memory fixture changes. This route and its variants are throwaway code.

## Common Minimum Screen Plan

All three variants converge on the same implementation boundary even though their navigation differs:

- `/services` — create and edit Service name, duration, price, lifecycle, and Provider eligibility.
- `/availability` — edit recurring Provider Schedule Rules and inspect derived Availability.
- `/appointments` — inspect confirmed Appointment snapshots and Customer Details.
- `/customers` — inspect the appointment-derived Customer Directory; no profile writes.
- `/settings` — own Merchant-wide configuration, with secondary screens for `/settings/public-page` and `/settings/checkout`.
- Team-only Provider management — either `/providers` as a gated operational destination or `/settings/providers` in the guided model. Solo hides it while retaining the default Provider in data.

There is no first-slice Shop, Brand, stored Time Slot, durable Customer profile, Sale Order, or separate Confirmation-management screen. Solo hides Provider management while retaining the default Provider in the data model; Team reveals it when eligibility and schedule assignment matter.

The prototype exercises Merchant/public-page editing, Service and Provider creation, Schedule Rule editing, publication state, derived readiness/availability, and Appointment/Customer inspection. It deliberately performs no real persistence or booking mutations.

## Legacy Source Evidence

The revised prototype is grounded in `/Users/hassan/Desktop/ssqu/recreate/apps/app`, not only in the target ADRs. The detailed source-to-target mapping is captured in [`research/06-legacy-merchant-surface.md`](../../.scratch/booking-product-recreation/research/06-legacy-merchant-surface.md).

The strongest retained signals are:

- Appointments as the legacy returning-user home, with a provider-by-provider day calendar.
- Services as a two-step Details → assignment flow.
- Providers as a tabbed Profile / Services / Schedule configuration surface.
- Shop Details as the source for identity, timezone, schedules, any-provider behavior, and legacy checkout policy—but split across smaller target-owned screens. Issue 09 later removed Checkout Policy from the first-slice target in favor of a fixed Pay In Person Checkout Path.

The strongest deliberate cuts are Shop/Brand switching, standalone Customer mutation, manual Appointment creation/editing, days on/off, future schedules, POS/register behavior, refunds/charges, payroll, notifications, reports, marketing, and Sale Orders.

## Verdict

**Variant B — Source-reduced operations rail is the migration baseline.** The legacy Merchant App remains the behavioral and interaction reference: Appointments is the returning-user home, Services retain the Details → Provider eligibility flow, and Team Providers retain the reduced Profile / Services / Schedule tabs.

Variant A is not a competing application shell. Its Booking Readiness path may later become an onboarding layer over the stable operational routes. Variant C is not a competing shell either; its customer-journey chain is useful as a domain-traceability aid when implementation tickets need to show which merchant input affects which booking step.

The migration is behavioral, not a wholesale code port. Production surfaces should be rewritten through TanStack Start routes, Effect capabilities, and D1 persistence. Delete each corresponding prototype screen as its production replacement lands; remove the switcher and remaining throwaway route after the final surface is absorbed.
