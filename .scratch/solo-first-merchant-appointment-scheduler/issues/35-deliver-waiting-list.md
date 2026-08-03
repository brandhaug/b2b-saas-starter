# Deliver the Waiting List Operating Loop

Type: task
Status:
Blocked by: 28, 29, 32

## Question

Deliver the Waiting List end to end: explicit Shop admission and Service eligibility, capacity, direct-booking preference, protected applications and recovery, exact demand windows, replacement applications that preserve an existing Appointment, deterministic FIFO opening evaluation, one reasoned override, sequential fifteen-minute offers, constrained holds, accept/decline/withdraw/expiry/slot-loss behavior, atomic confirmation or replacement conversion, required email, scheduled recovery, pauses under invalid gates, and cohort-safe metrics without ranks, optimization, or mobile messaging.

## Acceptance criteria

- [ ] New demand is admitted only when no matching Time Slot is currently bookable and all publication, readiness, subscription, Service, ban, and capacity gates pass atomically.
- [ ] Opening allocation, public booking races, offer expiry, duplicate workers, and replacement conversion are deterministic, conflict-safe, idempotent, and auditable.
- [ ] Failed offers return eligible applications to Active without corrupting FIFO age; paused applications remain inspectable rather than discarded.
- [ ] Protected customer access and all lifecycle email reveal no other customer's identity, order, demand, or Appointment.
