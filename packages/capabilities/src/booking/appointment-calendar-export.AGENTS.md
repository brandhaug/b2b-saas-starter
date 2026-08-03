# Appointment Calendar Export

`appointment-calendar-export.ts` owns transient, privacy-minimal RFC 5545 exports
for Appointments visible through current Confirmation Access.

- Accept only customer-visible Appointment snapshot and Shop presentation facts.
- Exclude Customer Details, credentials, and private Provider facts by construction.
- Generate exports on demand; do not persist a public artifact or synchronization
  channel.
- Treat only scheduled Appointments in the scoped Confirmation as exportable.
- Surface malformed snapshot facts through Effect's typed error channel.
