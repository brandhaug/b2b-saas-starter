# Prototype Minimum Merchant Surface

Type: prototype
Status: done
Blocked by: 02, 04, 05

## Question

What is the smallest Merchant App surface that can create, edit, or inspect the data needed for the first customer booking journey?

Produce a low-fidelity route and screen plan for merchant-managed shops, services, barbers or professionals, hours or availability, and appointment/sale confirmation review. The prototype should be rough enough to change and concrete enough for implementation tickets.

## Result

The throwaway Merchant App prototype lives at [`apps/merchant`](../../../apps/merchant) and runs with:

```bash
bun run prototype:merchant
```

Compare the three structurally different surfaces at `http://localhost:3072/prototype/minimum-merchant-surface?variant=A`:

- **A — Guided launch:** configuration is an ordered path toward Booking Readiness.
- **B — Source-reduced operations rail:** the legacy Appointments-first shell is reduced to the first-slice routes, including a provider day calendar, Service Details → Providers, and Provider Profile/Services/Schedule tabs.
- **C — Booking chain:** merchant inputs are arranged by the customer journey they influence.

The floating switcher and left/right arrow keys update the shareable `variant` search parameter. All writes are in-memory and the full persisted/derived/absent prototype state is rendered after each change.

## Common Minimum Boundary

The variants agree on `/services`, `/availability`, `/appointments`, `/customers`, and `/settings`, with a secondary settings screen for the public page. Their checkout settings prototype is superseded by issue 09: the target has no Merchant Checkout Policy and applies the Pay In Person Checkout Path automatically. Team-only Provider management is either a gated `/providers` destination or nested under Settings; Solo hides it while retaining its default Provider. Shops and Brands are absent because issue 04 settled them as future growth structure rather than first-slice persistence. Availability, Booking Readiness, and the Customer Directory are inspected as derived views; Appointments expose immutable booking snapshots rather than a Sale Order or separate Confirmation record.

The source-to-target evidence from `/Users/hassan/Desktop/ssqu/recreate/apps/app` is recorded in [`research/06-legacy-merchant-surface.md`](../research/06-legacy-merchant-surface.md). It covers the legacy route/nav order, Shop mega-form, two-step Service assignment, tabbed Barber form, provider-by-provider Appointment calendar, Appointment detail modal, and change-confirmation screen, plus the behavior deliberately excluded from the target first slice.

## Verdict

Variant B is the migration baseline. The legacy Merchant App is the behavioral and interaction reference, reduced to the target first-slice domain and scope. Variant A survives only as a possible onboarding layer, and Variant C survives only as a domain-traceability aid.

This is a behavioral migration rather than a wholesale React 17/Redux/React Router 3 code port. Production surfaces will be rewritten through TanStack Start, Effect capabilities, and D1, with each throwaway prototype screen deleted as its production replacement lands. The detailed verdict and cleanup rule are recorded in [`apps/merchant/PROTOTYPE_NOTES.md`](../../../apps/merchant/PROTOTYPE_NOTES.md).
