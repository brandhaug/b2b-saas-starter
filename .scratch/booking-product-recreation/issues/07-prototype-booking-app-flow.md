# Prototype Booking App Flow

Type: prototype
Status: done
Blocked by: 01, 02, 05

## Question

What customer-facing Booking App flow should the first Booking Vertical Slice implement, and what visual/component strategy should it use?

Decide route shape, navigation model, mobile and desktop layout expectations, state transitions, empty/error states, and whether to adapt source components/assets or rebuild the flow with this repo's design system.

## Result

The source-faithful Booking App migration spike lives at [`apps/booking`](../../../apps/booking) and runs with:

```bash
bun run prototype:booking
```

Open `http://localhost:3073/demo-shop/booking?scenario=ready`. The `scenario` parameter also exposes `no-services`, `no-times`, and `slot-lost` states.

The spike was built after reading and running `/Users/hassan/Desktop/ssqu/recreate/apps/booking-app` against its mock API. It preserves the legacy `375px` booking rail, provider grid, Primary Service to Additional Services transition, persistent order summary, full-height dark drawer, calendar strip, time grid, checkout progression, and detailed confirmation receipt.

The implementation uses TanStack Start and compiled StyleX. It does not retain React Router 5, Styled Components, query-string cart authorization, or legacy Cart/Sale Order concepts. The source evidence, proposed production routes, and source-to-target substitutions are recorded in [`apps/booking/PROTOTYPE_NOTES.md`](../../../apps/booking/PROTOTYPE_NOTES.md).

## Verdict

Migrate one vertical legacy flow into the new stack, preserving behavior and visuals while documenting architectural substitutions.

The Legacy Booking App is the executable product specification. Production work should preserve its customer-facing interaction grammar while replacing its framework, state, authorization, and domain plumbing with TanStack Start routes, StyleX components, Effect capability contracts, server-backed Booking Sessions, Time Slot Holds, Booking Quotes, and committed Appointments.
