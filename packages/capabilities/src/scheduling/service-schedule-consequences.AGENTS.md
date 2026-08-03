# Service schedule consequences

`service-schedule-consequences.ts` owns the Scheduling consequences of Merchant Catalog
changes. It prepares the hold re-evaluation and immutable Schedule Change statements so
the Catalog command can include them in the same D1 batch as its source mutation without
depending on Booking or Scheduling storage rules.

Service duration and buffer changes remove only holds whose occupied interval is no
longer valid against working hours, blocks, Appointments, or competing active holds.
Lifecycle deactivation removes every active hold containing that Service. Eligibility
replacement removes only holds whose assigned Provider is no longer eligible.
