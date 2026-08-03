# Deliver the Walk-in Queue Operating Loop

Type: task
Status:
Blocked by: 28, 29, 32

## Question

Deliver one presence-gated FIFO Walk-in Queue end to end: Owner configuration, rotating onsite capability, Turnstile and abuse controls, self and assisted enrollment, capacity, protected status, advisory Solo-provider estimates, ordering, call and return, edit, start, finish, abort, removal, closure, notification consequences, and atomic Appointment conversion against current conflicts. Preserve admitted demand as an existing commitment during Restricted Access and keep remote demand, realtime, GPS, Team assignment, and hidden customer disclosure outside the loop.

## Acceptance criteria

- [ ] Only a current consumable onsite presence capability or authorized Owner action can admit an entry, with generic abuse and rejection responses.
- [ ] Every queue command is revisioned, idempotent, auditable, Merchant-scoped, and keeps queue and linked Appointment state consistent.
- [ ] Starting service atomically revalidates capacity and creates the linked Appointment without double booking or partial conversion.
- [ ] Protected customer access reveals only that customer's Services, state, position, and advisory estimate; required email and recovery are durable.
